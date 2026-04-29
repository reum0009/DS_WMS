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

async function clickAny(page, labels) {
  for (const label of labels) {
    const btn = page.locator(`button:has-text("${label}"), a:has-text("${label}")`).first();
    if (await btn.count()) {
      await btn.click({ timeout: 10000 });
      return label;
    }
  }
  return null;
}

async function runGwDocAction(docId) {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch (e) {
    throw new Error('playwright-core 모듈이 필요합니다. npm install playwright-core');
  }

  const baseUrl = process.env.GW_WEB_BASE_URL || 'https://gw.dae-seung.co.kr';
  const username = process.env.GW_WEB_USER || 'test2';
  const password = process.env.GW_WEB_PASS || 'eotmd12#$';
  const headless = parseHeadless(process.env.GW_WEB_HEADLESS);
  const timeout = Number(process.env.GW_WEB_TIMEOUT_MS || 30000);

  if (!docId) throw new Error('GW 문서번호가 필요합니다.');
  if (!username || !password) throw new Error('GW_WEB_USER / GW_WEB_PASS 설정이 필요합니다.');

  const outDir = path.join(process.cwd(), 'logs', 'gw-auto');
  fs.mkdirSync(outDir, { recursive: true });
  const shotBase = path.join(outDir, `gw_${docId}_${nowStamp()}`);

  let browser;
  try {
    try {
      browser = await chromium.launch({ channel: 'msedge', headless });
    } catch (_) {
      browser = await chromium.launch({
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        headless,
      });
    }

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#username');
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('#login_submit');
    await page.waitForTimeout(2500);

    if (await page.locator('#loginForm').count()) {
      const msg = await page.locator('.login_msg .txt').first().textContent().catch(() => '');
      throw new Error(`그룹웨어 로그인 실패${msg ? `: ${msg}` : ''}`);
    }

    const docUrl = `${baseUrl}/app/works/applet/22/doc/${docId}/navigate`;
    await page.goto(docUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const clicked = [];

    // 1) 운영자 승인
    const approve = await clickAny(page, ['운영자 승인']);
    if (approve) {
      clicked.push(approve);
      await page.waitForTimeout(2500);
    }

    // 2) 운영자 출고 / 지급완료
    const release = await clickAny(page, ['운영자 출고', '지급완료']);
    if (release) {
      clicked.push(release);
      await page.waitForTimeout(2500);
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const alreadyDone = bodyText.includes('지급완료') || bodyText.includes('출고완료');

    await page.screenshot({ path: `${shotBase}_after.png`, fullPage: true });

    if (!clicked.length && !alreadyDone) {
      throw new Error('운영자 승인/출고 버튼을 찾지 못했습니다.');
    }

    return {
      ok: true,
      clicked,
      alreadyDone,
      screenshot: `${shotBase}_after.png`,
    };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { runGwDocAction };

