#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

function getArg(name, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env[`GW_${name.toUpperCase()}`] || fallback;
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function clickActionButton(page, candidates) {
  for (const label of candidates) {
    const btn = page.locator(`button:has-text("${label}"), a:has-text("${label}")`).first();
    if (await btn.count()) {
      await btn.click({ timeout: 10000 });
      return { clicked: true, label };
    }
  }

  return { clicked: false, label: '' };
}

async function main() {
  const docId = getArg('doc');
  const username = getArg('user');
  const password = getArg('pass');
  const action = (getArg('action', 'auto') || 'auto').toLowerCase(); // auto | approve | release
  const headless = (getArg('headless', 'true') || 'true').toLowerCase() !== 'false';

  if (!docId || !username || !password) {
    console.error('Usage: node scripts/gw_doc_action_test.js --doc 6669 --user test2 --pass "password" [--action auto|approve|release] [--headless true|false]');
    process.exit(2);
  }

  const baseUrl = 'https://gw.dae-seung.co.kr';
  const docUrl = `${baseUrl}/app/works/applet/22/doc/${docId}/navigate`;
  const outDir = path.join(process.cwd(), 'logs', 'gw-test');
  fs.mkdirSync(outDir, { recursive: true });
  const shotBase = path.join(outDir, `gw_${docId}_${nowStamp()}`);

  let browser;
  try {
    browser = await chromium.launch({
      channel: 'msedge',
      headless,
    });
  } catch (e) {
    // Fallback to common Edge path
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless,
    });
  }

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    console.log('[1/5] Open login page');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#username');
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('#login_submit');

    console.log('[2/5] Wait post-login navigation');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shotBase}_after_login.png`, fullPage: true });

    // If captcha or login failure
    const hasLoginForm = await page.locator('#loginForm').count();
    if (hasLoginForm) {
      const msg = await page.locator('.login_msg .txt').first().textContent().catch(() => '');
      throw new Error(`Login did not complete${msg ? `: ${msg}` : ''}`);
    }

    console.log('[3/5] Move to target doc');
    await page.goto(docUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shotBase}_doc_loaded.png`, fullPage: true });

    console.log('[4/5] Click action button(s)');
    const clickedLabels = [];
    if (action === 'approve') {
      const c1 = await clickActionButton(page, ['운영자 승인']);
      if (!c1.clicked) throw new Error('Target action button not found: 운영자 승인');
      clickedLabels.push(c1.label);
    } else if (action === 'release') {
      const c1 = await clickActionButton(page, ['운영자 출고', '지급완료']);
      if (!c1.clicked) throw new Error('Target action button not found: 운영자 출고/지급완료');
      clickedLabels.push(c1.label);
    } else {
      // auto: 승인 -> 출고(지급완료) 순서로 시도
      const c1 = await clickActionButton(page, ['운영자 승인']);
      if (c1.clicked) {
        clickedLabels.push(c1.label);
        await page.waitForTimeout(2500);
      }

      const c2 = await clickActionButton(page, ['운영자 출고', '지급완료']);
      if (c2.clicked) {
        clickedLabels.push(c2.label);
      }

      // 아무 버튼도 못 누른 경우만 실패
      if (clickedLabels.length === 0) {
        throw new Error('Target action button not found: 운영자 승인/운영자 출고/지급완료');
      }
    }
    console.log(`Clicked: ${clickedLabels.join(' -> ')}`);

    console.log('[5/5] Capture result');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${shotBase}_after_click.png`, fullPage: true });

    // Try to read toast/alert-like text
    const bodyText = await page.locator('body').innerText();
    const hints = bodyText
      .split('\n')
      .filter((t) => t.includes('완료') || t.includes('성공') || t.includes('오류') || t.includes('실패'))
      .slice(0, 10);

    console.log('DONE');
    if (hints.length) {
      console.log('HINTS:', hints.join(' | '));
    }
    console.log('SCREENSHOTS:', `${shotBase}_after_login.png`, `${shotBase}_doc_loaded.png`, `${shotBase}_after_click.png`);
    await browser.close();
    process.exit(0);
  } catch (e) {
    try {
      await page.screenshot({ path: `${shotBase}_error.png`, fullPage: true });
    } catch (_) {}
    console.error('FAILED:', e.message);
    console.error('SCREENSHOT:', `${shotBase}_error.png`);
    await browser.close();
    process.exit(1);
  }
}

main();
