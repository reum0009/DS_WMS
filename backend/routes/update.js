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

const { getDeployTargets } = require('../deploy-targets');
const DEPLOY_TARGETS = getDeployTargets(ROOT);

// multer: updates/ 폴더에 zip 저장
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPDATES_DIR),
    filename:    (req, file, cb) => cb(null, file.originalname),
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
    const files = fs.readdirSync(UPDATES_DIR)
      .filter(f => f.endsWith('.zip'))
      .map(f => {
        const stat = fs.statSync(path.join(UPDATES_DIR, f));
        return { name: f, size: (stat.size / 1024).toFixed(1) + ' KB', date: stat.mtime };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(files);
  } catch { res.json([]); }
});

// POST /api/update/upload — zip 업로드
router.post('/upload', auth, adminOnly, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  res.json({ message: '업로드 완료', filename: req.file.filename, size: req.file.size });
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
          const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
          const proc = spawn(npmCmd, ['install', '--omit=dev'], { cwd: path.join(ROOT, 'backend'), shell: false });
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

    res.json({ message: '다운로드 완료', filename, size: (buf.length / 1024).toFixed(1) + ' KB' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/update/create-package — 서버에서 업데이트 zip 생성
router.post('/create-package', auth, adminOnly, async (req, res) => {
  const version = String(req.body?.version || '').trim();
  const buildFrontend = !!req.body?.buildFrontend;
  const sourceRootInput = String(req.body?.sourceRoot || '').trim();

  if (!version) return res.status(400).json({ error: 'version 값이 필요합니다.' });
  if (!/^[0-9A-Za-z._-]+$/.test(version)) {
    return res.status(400).json({ error: 'version 형식이 올바르지 않습니다. (영문/숫자/.-_ 만 허용)' });
  }

  const packageRoot = sourceRootInput ? path.resolve(sourceRootInput) : ROOT;
  const packageInstallerDir = path.join(packageRoot, 'installer');
  const packageBuildScript = path.join(packageInstallerDir, 'build-package.js');
  const packageAppZip = path.join(packageInstallerDir, 'app.zip');
  const packageFrontendDir = path.join(packageRoot, 'frontend');

  if (!fs.existsSync(packageBuildScript)) {
    return res.status(400).json({ error: `유효한 소스 경로가 아닙니다. build-package.js 없음: ${packageBuildScript}` });
  }
  if (!fs.existsSync(path.join(packageRoot, 'backend', 'package.json'))) {
    return res.status(400).json({ error: `유효한 소스 경로가 아닙니다. backend/package.json 없음: ${packageRoot}` });
  }

  const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
    const actualCmd = (process.platform === 'win32' && cmd === 'npm') ? 'npm.cmd' : cmd;
    const child = spawn(actualCmd, args, { cwd, shell: false });
    let stderr = '';
    child.stdout.on('data', d => appendLog(String(d).trim()));
    child.stderr.on('data', d => {
      const line = String(d).trim();
      stderr += line + '\n';
      appendLog(line);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${cmd} 종료 코드: ${code}`));
    });
    child.on('error', reject);
  });

  try {
    appendLog(`=== 업데이트 패키지 생성 시작: v${version} (source=${packageRoot}) ===`);
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
    fs.mkdirSync(RELEASES_DIR, { recursive: true });

    if (buildFrontend) {
      if (!fs.existsSync(path.join(packageFrontendDir, 'package.json'))) {
        return res.status(400).json({ error: '프론트엔드 소스가 없어 빌드를 실행할 수 없습니다.' });
      }
      appendLog('프론트엔드 빌드 실행: npm run build');
      await run('npm', ['run', 'build'], packageFrontendDir);
    } else {
      appendLog('프론트엔드 빌드 생략');
    }

    appendLog(`build-package.js 실행: version=${version}`);
    await run('node', [packageBuildScript, version], packageRoot);

    if (!fs.existsSync(packageAppZip)) {
      throw new Error('installer/app.zip 생성 실패');
    }

    const filename = `release-v${version}.zip`;
    const updateDest = path.join(UPDATES_DIR, filename);
    const releaseDest = path.join(RELEASES_DIR, filename);
    fs.copyFileSync(packageAppZip, updateDest);
    fs.copyFileSync(packageAppZip, releaseDest);

    appendLog(`업데이트 패키지 생성 완료: ${filename}`);
    res.json({
      message: `업데이트 패키지 생성+업로드 완료: ${filename}`,
      filename,
      uploadedFilename: filename,
      uploadedToUpdates: true,
      sourceRoot: packageRoot,
      buildFrontend,
      copied: [updateDest, releaseDest],
    });
  } catch (e) {
    appendLog(`업데이트 패키지 생성 오류: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
