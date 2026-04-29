const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { exec } = require('child_process');
const archiver = require('archiver');

const router      = express.Router();
const ROOT        = path.join(__dirname, '../..');
const RELEASES    = path.join(ROOT, 'releases');
const MANIFEST    = path.join(RELEASES, 'manifest-latest.json');
const VERSION_FILE = path.join(ROOT, 'version.json');

const { getDeployTargets } = require('../../deploy-targets');
const DEPLOY_TARGETS = getDeployTargets(ROOT);

// 파일 해시 계산
function hashFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch { return null; }
}

// 디렉토리 내 모든 파일 재귀 수집
function collectFiles(dir, exclude = []) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const walk = (current) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude.includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(full);
    }
  };
  walk(dir);
  return results;
}

// 전체 배포 파일 해시 맵 생성
function buildHashMap() {
  const map = {};
  for (const target of DEPLOY_TARGETS) {
    const files = collectFiles(target.base, target.exclude);
    for (const file of files) {
      const rel = target.prefix + '/' + path.relative(target.base, file).replace(/\\/g, '/');
      map[rel] = hashFile(file);
    }
  }
  // version.json 포함
  map['version.json'] = hashFile(VERSION_FILE);
  return map;
}

// SSE 클라이언트 목록
const sseClients = [];

function sendProgress(msg, type = 'log') {
  const data = JSON.stringify({ msg, type, time: new Date().toLocaleTimeString('ko-KR') });
  sseClients.forEach(res => res.write(`data: ${data}\n\n`));
  console.log(`[release] ${msg}`);
}

// GET /api/release/info — 현재 버전 및 마지막 릴리즈 정보
router.get('/info', (req, res) => {
  const version = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  const hasManifest = fs.existsSync(MANIFEST);
  const lastManifest = hasManifest ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
  res.json({ version, lastRelease: lastManifest?.meta || null });
});

// GET /api/release/progress — SSE 스트림
router.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// POST /api/release/build — 릴리즈 빌드
router.post('/build', async (req, res) => {
  const { version, buildFrontend = true } = req.body;
  if (!version) return res.status(400).json({ error: '버전을 입력하세요.' });

  res.json({ message: '빌드를 시작합니다.' });

  try {
    sendProgress(`=== 릴리즈 v${version} 빌드 시작 ===`, 'start');

    // 1. version.json 업데이트
    const today = new Date().toISOString().split('T')[0];
    fs.writeFileSync(VERSION_FILE, JSON.stringify({ version, buildDate: today }, null, 2));
    sendProgress(`version.json → v${version} (${today})`);

    // 2. 프론트엔드 빌드
    if (buildFrontend) {
      sendProgress('프론트엔드 빌드 중... (npm run build)', 'build');
      await new Promise((resolve, reject) => {
        const proc = exec('npm run build', { cwd: path.join(ROOT, 'frontend') });
        proc.stdout.on('data', d => sendProgress(d.toString().trim()));
        proc.stderr.on('data', d => sendProgress(d.toString().trim()));
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`빌드 실패 (exit ${code})`)));
      });
      sendProgress('프론트엔드 빌드 완료', 'done');
    } else {
      sendProgress('프론트엔드 빌드 스킵');
    }

    // 3. 파일 해시 계산
    sendProgress('파일 해시 계산 중...');
    const newMap  = buildHashMap();
    const oldMap  = fs.existsSync(MANIFEST)
      ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).files || {}
      : {};

    // 4. 변경 파일 감지
    const changed = Object.keys(newMap).filter(k => newMap[k] !== oldMap[k]);
    const deleted = Object.keys(oldMap).filter(k => !newMap[k]);
    sendProgress(`변경된 파일: ${changed.length}개 / 삭제: ${deleted.length}개`, 'info');
    changed.forEach(f => sendProgress(`  + ${f}`));
    deleted.forEach(f => sendProgress(`  - ${f}`));

    if (changed.length === 0) {
      sendProgress('변경된 파일이 없습니다. 빌드를 중단합니다.', 'warn');
      sendProgress('DONE:none', 'done');
      return;
    }

    // 5. zip 생성
    const zipName = `release-v${version}.zip`;
    const zipPath = path.join(RELEASES, zipName);
    sendProgress(`${zipName} 생성 중...`);

    const manifest = { meta: { version, buildDate: today, changedFiles: changed.length }, files: newMap };

    await new Promise((resolve, reject) => {
      const output  = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(output);

      // manifest.json 추가
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // 변경된 파일 추가
      for (const rel of changed) {
        const target = DEPLOY_TARGETS.find(t => rel.startsWith(t.prefix + '/'));
        if (!target && rel === 'version.json') {
          archive.file(VERSION_FILE, { name: 'files/version.json' });
          continue;
        }
        if (!target) continue;
        const filePath = path.join(target.base, rel.slice(target.prefix.length + 1));
        archive.file(filePath, { name: `files/${rel}` });
      }

      archive.finalize();
      output.on('close', resolve);
      archive.on('error', reject);
    });

    const zipSize = (fs.statSync(zipPath).size / 1024).toFixed(1);
    sendProgress(`${zipName} 생성 완료 (${zipSize} KB)`, 'done');

    // 6. manifest-latest.json 업데이트
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    sendProgress('manifest-latest.json 업데이트 완료');

    sendProgress(`=== 빌드 완료: ${zipName} ===`, 'start');
    sendProgress(`DONE:${zipName}`, 'done');

  } catch (e) {
    sendProgress(`오류: ${e.message}`, 'error');
    sendProgress('DONE:error', 'done');
  }
});

// GET /api/release/download/:filename — zip 다운로드
router.get('/download/:filename', (req, res) => {
  const zipPath = path.join(RELEASES, req.params.filename);
  if (!fs.existsSync(zipPath)) return res.status(404).json({ error: '파일 없음' });
  res.download(zipPath);
});

// GET /api/release/list — 릴리즈 목록
router.get('/list', (req, res) => {
  const files = fs.existsSync(RELEASES)
    ? fs.readdirSync(RELEASES).filter(f => f.endsWith('.zip'))
        .map(f => {
          const stat = fs.statSync(path.join(RELEASES, f));
          return { name: f, size: (stat.size / 1024).toFixed(1) + ' KB', date: stat.mtime };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))
    : [];
  res.json(files);
});

module.exports = router;
