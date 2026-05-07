const fs = require('fs');
const path = require('path');

function parseHeadless(v) {
  return String(v ?? 'true').toLowerCase() !== 'false';
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function clickAny(page, labels) {
  for (const label of labels) {
    const clicked = await page.evaluate((text) => {
      const el = [...document.querySelectorAll('button, a')]
        .find(e => (e.innerText || '').includes(text));
      if (el) { el.click(); return true; }
      return false;
    }, label);
    if (clicked) return label;
  }
  return null;
}

const GW_RELEASED_STATUS_IDS = new Set([111, 157]);
const GW_RELEASE_ACTIONS = ['운영자 출고', '지급완료'];
const GW_APPROVE_ACTIONS = ['운영자 승인'];

function makeCookieJar() {
  const jar = new Map();
  return {
    header() {
      return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    store(res) {
      const setCookies = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      setCookies.forEach((line) => {
        const [cookie] = String(line).split(';');
        const idx = cookie.indexOf('=');
        if (idx > 0) jar.set(cookie.slice(0, idx), cookie.slice(idx + 1));
      });
    }
  };
}

async function gwFetch(session, pathName, options = {}) {
  const cookie = session.jar.header();
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers || {}),
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const res = await fetch(`${session.baseUrl}${pathName}`, { ...options, headers });
  session.jar.store(res);
  return res;
}

async function readGwJson(res, context) {
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`${context} 응답을 해석할 수 없습니다: ${text.slice(0, 200)}`);
  }
  if (!res.ok || (payload.code && String(payload.code) !== '200')) {
    throw new Error(payload.message || `${context} 실패 (${res.status})`);
  }
  return payload;
}

async function createGwSession() {
  const session = {
    baseUrl: (process.env.GW_WEB_BASE_URL || 'https://gw.dae-seung.co.kr').replace(/\/+$/, ''),
    jar: makeCookieJar(),
  };
  const username = process.env.GW_WEB_USER || 'test2';
  const password = process.env.GW_WEB_PASS || 'eotmd12#$';

  await gwFetch(session, '/login');
  const loginRes = await gwFetch(session, '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, captcha: '', returnUrl: '' }),
  });
  await readGwJson(loginRes, '그룹웨어 로그인');
  return session;
}

async function getGwDocStatus(session, docId) {
  const res = await gwFetch(session, `/api/works/applets/22/docs/${docId}`);
  const payload = await readGwJson(res, '그룹웨어 문서 조회');
  return payload.data?.status || null;
}

async function getGwActions(session, docId) {
  const res = await gwFetch(session, `/api/works/applets/22/docs/${docId}/actions`);
  const payload = await readGwJson(res, '그룹웨어 액션 조회');
  return Array.isArray(payload.data) ? payload.data : [];
}

function findGwAction(actions, names) {
  return actions.find((action) => names.includes(String(action.name || '').trim())) || null;
}

async function putGwAction(session, docId, action) {
  const res = await gwFetch(session, `/api/works/applets/22/docs/${docId}/actions/${action.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const payload = await readGwJson(res, `그룹웨어 ${action.name} 처리`);
  return payload.data || {};
}

async function completeGwDocRelease(docId) {
  if (!docId) throw new Error('GW 문서번호가 필요합니다');

  const session = await createGwSession();
  const clicked = [];
  const startStatus = await getGwDocStatus(session, docId);
  if (startStatus && GW_RELEASED_STATUS_IDS.has(Number(startStatus.id))) {
    return { ok: true, method: 'web-api-action', alreadyDone: true, startStatus, finalStatus: startStatus, clicked };
  }

  let currentStatus = startStatus;
  for (let i = 0; i < 3; i += 1) {
    const actions = await getGwActions(session, docId);
    const releaseAction = findGwAction(actions, GW_RELEASE_ACTIONS);
    const approveAction = findGwAction(actions, GW_APPROVE_ACTIONS);
    const action = releaseAction || approveAction;

    if (!action) {
      const actionNames = actions.map(a => a.name).filter(Boolean).join(', ') || '없음';
      throw new Error(`그룹웨어 운영자 출고 버튼을 찾지 못했습니다. 현재 상태: ${currentStatus?.name || '-'}, 가능 버튼: ${actionNames}`);
    }

    const result = await putGwAction(session, docId, action);
    clicked.push({ id: action.id, name: action.name });
    currentStatus = result.status || await getGwDocStatus(session, docId);

    if (currentStatus && GW_RELEASED_STATUS_IDS.has(Number(currentStatus.id))) {
      return { ok: true, method: 'web-api-action', alreadyDone: false, startStatus, finalStatus: currentStatus, clicked };
    }
  }

  throw new Error(`그룹웨어 운영자 출고가 완료 상태로 바뀌지 않았습니다. 현재 상태: ${currentStatus?.name || '-'}`);
}

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean);

async function runGwDocAction(docId) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch (e) {
    throw new Error('puppeteer-core 모듈이 필요합니다: npm install puppeteer-core');
  }

  const baseUrl = process.env.GW_WEB_BASE_URL || 'https://gw.dae-seung.co.kr';
  const username = process.env.GW_WEB_USER || 'test2';
  const password = process.env.GW_WEB_PASS || 'eotmd12#$';
  const headless = parseHeadless(process.env.GW_WEB_HEADLESS);
  const timeout = Number(process.env.GW_WEB_TIMEOUT_MS || 30000);
  const log = (...args) => console.log('[GW-AUTO]', ...args);

  if (!docId) throw new Error('GW 문서번호가 필요합니다.');

  const outDir = path.join(process.cwd(), 'logs', 'gw-auto');
  fs.mkdirSync(outDir, { recursive: true });
  const shotBase = path.join(outDir, `gw_${docId}_${nowStamp()}`);

  const userDataDir = `C:\\tmp\\pptr_${Date.now()}`;
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch (_) {}

  let chromePath = null;
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) { chromePath = p; break; }
  }
  if (!chromePath) throw new Error('Chrome을 찾을 수 없습니다.');

  log(`docId=${docId}, headless=${headless}, chrome=${chromePath}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,   // 테스트: 창 보이게 실행 (headless 모드 버그 우회)
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--ignore-certificate-errors',
      ],
      timeout,
      dumpio: true,    // Chrome stdout/stderr를 서버 콘솔에 출력
    });
    log('browser launched');

    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);

    // Step 1: Login page
    log('goto', baseUrl);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout });
    await page.screenshot({ path: `${shotBase}_1_login.png` });
    log('login page loaded, url=', page.url());

    // Find username field — try multiple selectors
    const usernameSelectors = ['#username', 'input[name="username"]', 'input[type="text"]'];
    let usernameFound = false;
    for (const sel of usernameSelectors) {
      const el = await page.$(sel);
      if (el) {
        log('username selector found:', sel);
        await page.type(sel, username);
        usernameFound = true;
        break;
      }
    }
    if (!usernameFound) {
      await page.screenshot({ path: `${shotBase}_1b_no_username.png` });
      log('WARNING: username field not found, page title=', await page.title());
    }

    const passwordSelectors = ['#password', 'input[name="password"]', 'input[type="password"]'];
    for (const sel of passwordSelectors) {
      const el = await page.$(sel);
      if (el) {
        log('password selector found:', sel);
        await page.type(sel, password);
        break;
      }
    }

    const submitSelectors = ['#login_submit', 'button[type="submit"]', 'input[type="submit"]'];
    for (const sel of submitSelectors) {
      const el = await page.$(sel);
      if (el) {
        log('submit selector found:', sel);
        await page.click(sel);
        break;
      }
    }

    await sleep(3000);
    await page.screenshot({ path: `${shotBase}_2_after_login.png` });
    log('after login, url=', page.url());

    const loginFormVisible = await page.$('#loginForm');
    if (loginFormVisible) {
      const msg = await page.$eval('.login_msg .txt', el => el.textContent).catch(() => '');
      throw new Error(`그룹웨어 로그인 실패${msg ? `: ${msg}` : ''}`);
    }

    // Step 2: Navigate to document
    const docUrl = `${baseUrl}/app/works/applet/22/doc/${docId}/navigate`;
    log('goto doc', docUrl);
    await page.goto(docUrl, { waitUntil: 'domcontentloaded', timeout });
    await sleep(3000);
    await page.screenshot({ path: `${shotBase}_3_doc.png` });
    log('doc page loaded, url=', page.url());

    // Log all button/link texts for debugging
    const allBtnTexts = await page.evaluate(() =>
      [...document.querySelectorAll('button, a')]
        .map(e => e.innerText.trim())
        .filter(t => t.length > 0)
    );
    log('buttons/links on page:', JSON.stringify(allBtnTexts));

    const clicked = [];

    const approve = await clickAny(page, ['운영자 승인']);
    if (approve) {
      log('clicked:', approve);
      clicked.push(approve);
      await sleep(2500);
      await page.screenshot({ path: `${shotBase}_4_after_approve.png` });
    } else {
      log('운영자 승인 button not found');
    }

    const release = await clickAny(page, ['운영자 출고', '지급완료']);
    if (release) {
      log('clicked:', release);
      clicked.push(release);
      await sleep(2500);
      await page.screenshot({ path: `${shotBase}_5_after_release.png` });
    } else {
      log('운영자 출고/지급완료 button not found');
    }

    const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');
    const alreadyDone = bodyText.includes('지급완료') || bodyText.includes('출고완료');
    log('alreadyDone=', alreadyDone, 'clicked=', clicked);

    await page.screenshot({ path: `${shotBase}_6_final.png`, fullPage: true });

    if (!clicked.length && !alreadyDone) {
      throw new Error('운영자 승인/출고 버튼을 찾지 못했습니다. 스크린샷을 확인하세요: ' + shotBase);
    }

    return { ok: true, clicked, alreadyDone, screenshot: `${shotBase}_6_final.png` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { runGwDocAction, completeGwDocRelease };
