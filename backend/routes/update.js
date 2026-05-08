const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const AdmZip   = require('adm-zip');
const multer   = require('multer');
const { spawn } = require('child_process');
const { auth, adminOnly } = require('../middleware/auth');

const router      = express.Router();
const ROOT        = path.join(__dirname, '../..');
const VERSION_FILE = path.join(ROOT, 'version.json');
const UPDATES_DIR  = path.join(ROOT, 'updates');
const BACKUPS_DIR  = path.join(ROOT, 'updates', 'backups');
const RELEASES_DIR = path.join(ROOT, 'releases');
const UPDATE_LOG   = path.join(ROOT, 'update.log');
const PACKAGE_WORK_DIR = path.join(UPDATES_DIR, '.package-sources');
const MAX_STORED_PACKAGES = 3;

const { getDeployTargets } = require('../deploy-targets');
const DEPLOY_TARGETS = getDeployTargets(ROOT);

// multer: updates/ 폴더에 zip 저장
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPDATES_DIR),
    filename:    (req, file, cb) => {
      const safeName = path.basename(file.originalname);
      cb(null, `${Date.now()}-${safeName}.uploading`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.zip') cb(null, true);
    else cb(new Error('zip 파일만 업로드 가능합니다.'));
  },
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// ── 유틸 ─────────────────────────────────────────────────────────

function readVersion() {
  try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')); }
  catch { return { version: '1.0.0', buildDate: '' }; }
}

function hashFile(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch { return null; }
}

function collectFiles(dir, exclude = []) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (cur) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      if (exclude.includes(entry.name)) continue;
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(full);
    }
  };
  walk(dir);
  return results;
}

function appendLog(msg) {
  fs.appendFileSync(UPDATE_LOG, `[${new Date().toLocaleString('ko-KR')}] ${msg}\n`);
}

function listZipPackages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.zip'))
    .map(f => {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      return { name: f, fullPath, sizeBytes: stat.size, date: stat.mtime };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function prunePackageDir(dir, keep = MAX_STORED_PACKAGES) {
  const packages = listZipPackages(dir);
  const removed = [];
  for (const pkg of packages.slice(keep)) {
    try {
      fs.unlinkSync(pkg.fullPath);
      removed.push(pkg.name);
    } catch (e) {
      appendLog(`패키지 자동 삭제 실패: ${pkg.fullPath} (${e.message})`);
    }
  }
  if (removed.length) appendLog(`패키지 자동 정리(${path.basename(dir)}): ${removed.join(', ')}`);
  return listZipPackages(dir);
}

function enforcePackageRetention() {
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
  const updatePackages = prunePackageDir(UPDATES_DIR);
  prunePackageDir(RELEASES_DIR);
  return updatePackages;
}

function sanitizeGitUrl(url) {
  return String(url || '').replace(/:\/\/[^/@]+@/, '://***@');
}

function buildGithubCloneUrl(repo, token) {
  if (!repo) return '';
  const normalized = repo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  return token
    ? `https://x-access-token:${token}@github.com/${normalized}.git`
    : `https://github.com/${normalized}.git`;
}

function spawnRestart() {
  const isWin = process.platform === 'win32';
  const script = path.join(ROOT, isWin ? 'restart_backend.bat' : 'restart_backend.sh');
  if (fs.existsSync(script)) {
    const child = isWin
      ? spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', cwd: ROOT })
      : spawn('bash', [script], { detached: true, stdio: 'ignore', cwd: ROOT });
    child.unref();
  }
  process.exit(0);
}

// 현재 파일 전체를 백업 zip으로 저장
function createBackup(versionStr) {
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `backup-v${versionStr}-${ts}.zip`;
  const dest = path.join(BACKUPS_DIR, name);
  const zip  = new AdmZip();

  for (const target of DEPLOY_TARGETS) {
    const files = collectFiles(target.base, target.exclude);
    for (const file of files) {
      const rel = path.relative(target.base, file);
      zip.addLocalFile(file, path.join(target.prefix, path.dirname(rel)).replace(/\\/g, '/'));
    }
  }
  zip.addLocalFile(VERSION_FILE, '');
  zip.writeZip(dest);
  return name;
}

// zip에서 파일 추출 + 적용 (변경된 파일만)
function applyZip(zipPath) {
  const zip      = new AdmZip(zipPath);
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  const newFiles = manifest.files || {};
  const changed  = [];
  const pkgChanged = false;

  let packageJsonChanged = false;

  for (const [rel, newHash] of Object.entries(newFiles)) {
    // 실제 파일 경로 찾기
    const target = DEPLOY_TARGETS.find(t => rel.startsWith(t.prefix + '/'));
    let destPath;
    if (target) {
      destPath = path.join(target.base, rel.slice(target.prefix.length + 1));
    } else if (rel === 'version.json') {
      destPath = VERSION_FILE;
    } else continue;

    const curHash = hashFile(destPath);
    if (curHash === newHash) continue; // 변경 없음

    // zip 내부 경로: files/{rel}
    const entry = zip.getEntry(`files/${rel}`);
    if (!entry) continue;

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, entry.getData());
    changed.push(rel);

    if (rel === 'backend/package.json') packageJsonChanged = true;
  }

  return { changed, packageJsonChanged, manifest };
}

// ── API ──────────────────────────────────────────────────────────

// GET /api/update/check — 공개 (브라우저 버전 체크)
router.get('/check', (req, res) => res.json(readVersion()));

// GET /api/update/history — 업데이트 이력
router.get('/history', auth, adminOnly, async (req, res) => {
  try {
    const { UpdateHistory, User } = global.sequelize.models;
    const rows = await UpdateHistory.findAll({
      order: [['createdAt', 'DESC']],
      limit: 20,
      include: [{ model: User, as: 'applier', attributes: ['name', 'email'] }],
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/update/log — 로그 파일
router.get('/log', auth, adminOnly, (req, res) => {
  try {
    const log = fs.existsSync(UPDATE_LOG)
      ? fs.readFileSync(UPDATE_LOG, 'utf8').slice(-8000)
      : '로그 없음';
    res.json({ log });
  } catch { res.json({ log: '로그를 읽을 수 없습니다.' }); }
});

// GET /api/update/packages — updates/ 폴더의 zip 목록
router.get('/packages', auth, adminOnly, (req, res) => {
  try {
    const files = enforcePackageRetention()
      .slice(0, MAX_STORED_PACKAGES)
      .map(f => ({ name: f.name, size: (f.sizeBytes / 1024).toFixed(1) + ' KB', date: f.date }));
    res.json(files);
  } catch { res.json([]); }
});

// POST /api/update/upload — zip 업로드
router.post('/upload', auth, adminOnly, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  try {
    const filename = path.basename(req.file.originalname);
    let finalName = filename;
    let dest = path.join(UPDATES_DIR, finalName);

    if (fs.existsSync(dest)) {
      try {
        fs.unlinkSync(dest);
      } catch (e) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        finalName = `${base}-${ts}${ext}`;
        dest = path.join(UPDATES_DIR, finalName);
      }
    }

    fs.renameSync(req.file.path, dest);
    enforcePackageRetention();
    res.json({ message: '업로드 완료', filename: finalName, size: fs.statSync(dest).size });
  } catch (e) {
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: '업로드 파일 저장 실패: ' + e.message });
  }
});

// POST /api/update/apply — zip 적용
router.post('/apply', auth, adminOnly, async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename 필요' });

  const zipPath = path.join(UPDATES_DIR, filename);
  if (!fs.existsSync(zipPath)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });

  const { UpdateHistory } = global.sequelize.models;
  const verBefore = readVersion().version;

  let record;
  try {
    record = await UpdateHistory.create({
      versionBefore: verBefore,
      releaseFile:   filename,
      appliedBy:     req.user.id,
      status:        'in_progress',
    });
  } catch (e) { return res.status(500).json({ error: 'DB 기록 실패: ' + e.message }); }

  res.json({ message: '업데이트를 시작합니다. 잠시 후 서비스가 재시작됩니다.', recordId: record.id });

  setTimeout(async () => {
    try {
      appendLog(`=== 업데이트 시작: ${filename} ===`);

      // 1. 현재 파일 백업
      appendLog('현재 파일 백업 중...');
      const backupName = createBackup(verBefore);
      appendLog(`백업 완료: ${backupName}`);

      // 2. zip 적용
      appendLog('파일 교체 중...');
      const { changed, packageJsonChanged, manifest } = applyZip(zipPath);
      appendLog(`변경된 파일: ${changed.length}개`);
      changed.forEach(f => appendLog(`  → ${f}`));

      // 3. package.json 변경 시 npm install
      if (packageJsonChanged) {
        appendLog('package.json 변경 감지 → npm install 실행...');
        await new Promise((resolve) => {
          const proc = spawn('npm', ['install', '--omit=dev'], { cwd: path.join(ROOT, 'backend'), shell: process.platform === 'win32' });
          proc.on('close', resolve);
        });
        appendLog('npm install 완료');
      }

      const verAfter = readVersion().version;

      await record.update({
        versionAfter:  verAfter,
        backupFile:    backupName,
        changedFiles:  changed.length,
        status:        'success',
        notes:         changed.join('\n'),
      });

      appendLog(`=== 업데이트 완료: v${verBefore} → v${verAfter} ===`);
    } catch (e) {
      appendLog('오류: ' + e.message);
      try { await record.update({ status: 'failed', notes: e.message }); } catch {}
    } finally {
      spawnRestart();
    }
  }, 600);
});

// POST /api/update/rollback/:id — 특정 이력의 백업으로 롤백
router.post('/rollback/:id', auth, adminOnly, async (req, res) => {
  const { UpdateHistory } = global.sequelize.models;
  const target = await UpdateHistory.findByPk(req.params.id);

  if (!target)             return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
  if (!target.backupFile)  return res.status(400).json({ error: '백업 파일 정보가 없습니다.' });
  if (target.status === 'rolled_back') return res.status(400).json({ error: '이미 롤백된 항목입니다.' });

  const backupPath = path.join(BACKUPS_DIR, target.backupFile);
  if (!fs.existsSync(backupPath)) return res.status(404).json({ error: `백업 파일을 찾을 수 없습니다: ${target.backupFile}` });

  const verNow = readVersion().version;
  let rollbackRecord;
  try {
    rollbackRecord = await UpdateHistory.create({
      versionBefore: verNow,
      versionAfter:  target.versionBefore,
      releaseFile:   target.backupFile,
      appliedBy:     req.user.id,
      status:        'in_progress',
      notes:         `롤백 대상: #${target.id}`,
    });
  } catch (e) { return res.status(500).json({ error: 'DB 기록 실패: ' + e.message }); }

  res.json({ message: `v${target.versionBefore} 으로 롤백합니다.`, recordId: rollbackRecord.id });

  setTimeout(async () => {
    try {
      appendLog(`=== 롤백 시작: #${target.id} 백업 → ${target.backupFile} ===`);

      // 백업 zip 복원 (manifest 없이 전체 교체)
      const zip = new AdmZip(backupPath);
      zip.extractAllTo(ROOT, true);
      appendLog('파일 복원 완료');

      await Promise.all([
        rollbackRecord.update({ status: 'success' }),
        target.update({ status: 'rolled_back' }),
      ]);
      appendLog(`=== 롤백 완료: v${verNow} → v${target.versionBefore} ===`);
    } catch (e) {
      appendLog('롤백 오류: ' + e.message);
      try { await rollbackRecord.update({ status: 'rollback_failed', notes: e.message }); } catch {}
    } finally {
      spawnRestart();
    }
  }, 600);
});

// GET /api/update/github/check — GitHub 최신 릴리즈 확인 (GITHUB_REPO 설정 시)
router.get('/github/check', auth, adminOnly, async (req, res) => {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo) return res.status(400).json({ error: 'GITHUB_REPO 환경변수가 설정되지 않았습니다.' });

  try {
    const headers = { 'User-Agent': 'warehouse-pos', Accept: 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!response.ok) throw new Error(`GitHub API 오류: ${response.status}`);

    const release = await response.json();
    const current = readVersion();
    res.json({
      current:  current.version,
      latest:   release.tag_name?.replace(/^v/, ''),
      name:     release.name,
      body:     release.body,
      assets:   release.assets?.map(a => ({ name: a.name, size: a.size, url: a.browser_download_url })),
      htmlUrl:  release.html_url,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/update/github/download — GitHub 릴리즈 zip 다운로드
router.post('/github/download', auth, adminOnly, async (req, res) => {
  const { assetUrl, filename } = req.body;
  if (!assetUrl || !filename) return res.status(400).json({ error: 'assetUrl, filename 필요' });

  const token = process.env.GITHUB_TOKEN;
  const headers = { 'User-Agent': 'warehouse-pos', Accept: 'application/octet-stream' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const response = await fetch(assetUrl, { headers });
    if (!response.ok) throw new Error(`다운로드 실패: ${response.status}`);

    const dest = path.join(UPDATES_DIR, filename);
    const buf  = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, buf);
    enforcePackageRetention();

    res.json({ message: '다운로드 완료', filename, size: (buf.length / 1024).toFixed(1) + ' KB' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/update/create-package — 서버에서 업데이트 zip 생성
router.post('/create-package', auth, adminOnly, async (req, res) => {
  const version = String(req.body?.version || '').trim();
  const buildFrontend = !!req.body?.buildFrontend;
  const sourceRootInput = String(req.body?.sourceRoot || '').trim();
  const sourceMode = String(req.body?.sourceMode || '').trim();
  const gitBranch = String(req.body?.gitBranch || process.env.UPDATE_GIT_BRANCH || 'main').trim();

  if (!version) return res.status(400).json({ error: 'version 값이 필요합니다.' });
  if (!/^[0-9A-Za-z._-]+$/.test(version)) {
    return res.status(400).json({ error: 'version 형식이 올바르지 않습니다. (영문/숫자/.-_ 만 허용)' });
  }
  if (sourceMode === 'git' && !/^[0-9A-Za-z._/-]+$/.test(gitBranch)) {
    return res.status(400).json({ error: 'gitBranch 형식이 올바르지 않습니다.' });
  }

  const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    // Windows에서 .cmd 파일은 shell: true 없이 spawn하면 EINVAL 발생
    const child = spawn(cmd, args, { cwd, shell: isWin });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      const line = String(d).trim();
      stdout += String(d);
      if (line) appendLog(line);
    });
    child.stderr.on('data', d => {
      const line = String(d).trim();
      stderr += line + '\n';
      if (line) appendLog(line);
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${cmd} 종료 코드: ${code}`));
    });
    child.on('error', reject);
  });

  const prepareGitSource = async () => {
    const configuredRepo =
      process.env.UPDATE_GIT_REPO ||
      buildGithubCloneUrl(process.env.GITHUB_REPO, process.env.GITHUB_TOKEN);
    const remoteRepo = configuredRepo || await run('git', ['config', '--get', 'remote.origin.url'], ROOT);
    if (!remoteRepo) {
      throw new Error('Git 저장소 URL을 찾을 수 없습니다. UPDATE_GIT_REPO 또는 GITHUB_REPO를 설정하세요.');
    }

    fs.mkdirSync(PACKAGE_WORK_DIR, { recursive: true });
    const workRoot = path.join(PACKAGE_WORK_DIR, `release-${Date.now()}`);
    appendLog(`Git 소스 가져오기: ${sanitizeGitUrl(remoteRepo)} (${gitBranch})`);
    await run('git', ['clone', '--depth', '1', '--branch', gitBranch, remoteRepo, workRoot], ROOT);
    const commit = await run('git', ['rev-parse', '--short', 'HEAD'], workRoot);
    appendLog(`Git 소스 준비 완료: ${gitBranch}@${commit}`);

    return {
      packageRoot: workRoot,
      sourceInfo: { mode: 'git', repo: sanitizeGitUrl(remoteRepo), branch: gitBranch, commit },
      cleanup: () => {
        try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch (e) {
          appendLog(`Git 임시 소스 삭제 실패: ${e.message}`);
        }
      },
    };
  };

  let preparedSource;

  try {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
    fs.mkdirSync(RELEASES_DIR, { recursive: true });

    if (sourceMode === 'git') {
      preparedSource = await prepareGitSource();
    } else {
      const packageRoot = sourceRootInput ? path.resolve(sourceRootInput) : ROOT;
      preparedSource = {
        packageRoot,
        sourceInfo: {
          mode: sourceRootInput ? 'path' : 'local',
          root: packageRoot,
        },
        cleanup: null,
      };
    }

    const { packageRoot, sourceInfo } = preparedSource;
    const packageFrontendDir = path.join(packageRoot, 'frontend');

    if (!fs.existsSync(path.join(packageRoot, 'backend', 'package.json'))) {
      return res.status(400).json({ error: `유효한 소스 경로가 아닙니다. backend/package.json 없음: ${packageRoot}` });
    }

    appendLog(`=== 업데이트 패키지 생성 시작: v${version} (source=${sourceInfo.mode}, root=${packageRoot}) ===`);

    if (buildFrontend) {
      if (!fs.existsSync(path.join(packageFrontendDir, 'package.json'))) {
        return res.status(400).json({ error: '프론트엔드 소스가 없어 빌드를 실행할 수 없습니다.' });
      }
      if (!fs.existsSync(path.join(packageFrontendDir, 'node_modules'))) {
        appendLog('프론트엔드 의존성 설치: npm ci');
        await run('npm', ['ci'], packageFrontendDir);
      }
      appendLog('프론트엔드 빌드 실행: npm run build');
      await run('npm', ['run', 'build'], packageFrontendDir);
    } else {
      appendLog('프론트엔드 빌드 생략');
    }

    const filename = `release-v${version}.zip`;
    const updateDest = path.join(UPDATES_DIR, filename);
    const releaseDest = path.join(RELEASES_DIR, filename);
    const zip = new AdmZip();
    const manifest = {
      version,
      buildDate: new Date().toISOString().slice(0, 10),
      source: sourceInfo,
      files: {},
    };
    const packageTargets = getDeployTargets(packageRoot);

    for (const target of packageTargets) {
      const files = collectFiles(target.base, target.exclude);
      for (const file of files) {
        const rel = path.join(target.prefix, path.relative(target.base, file)).replace(/\\/g, '/');
        const data = fs.readFileSync(file);
        manifest.files[rel] = crypto.createHash('sha256').update(data).digest('hex');
        zip.addFile(`files/${rel}`, data);
      }
    }

    const versionData = Buffer.from(JSON.stringify({ version, buildDate: manifest.buildDate }, null, 2), 'utf8');
    manifest.files['version.json'] = crypto.createHash('sha256').update(versionData).digest('hex');
    zip.addFile('files/version.json', versionData);
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

    zip.writeZip(releaseDest);
    fs.copyFileSync(releaseDest, updateDest);
    enforcePackageRetention();

    appendLog(`업데이트 패키지 생성 완료: ${filename}`);
    res.json({
      message: `업데이트 패키지 생성+업로드 완료: ${filename}`,
      filename,
      uploadedFilename: filename,
      uploadedToUpdates: true,
      sourceRoot: packageRoot,
      source: sourceInfo,
      buildFrontend,
      copied: [updateDest, releaseDest],
    });
  } catch (e) {
    appendLog(`업데이트 패키지 생성 오류: ${e.message}`);
    res.status(500).json({ error: e.message });
  } finally {
    if (preparedSource?.cleanup) preparedSource.cleanup();
  }
});

module.exports = router;
