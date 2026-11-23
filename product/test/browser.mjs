import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { assertRasterPdf } from '../server/raster-pdf.mjs';

const base = process.env.CLEARCOPY_BASE_URL ?? 'http://127.0.0.1:8795';
const browser = await chromium.launch({ channel: process.env.CLEARCOPY_CHROME_CHANNEL ?? 'chrome', headless: true });
const dir = await mkdtemp(join(tmpdir(), 'clearcopy-browser-'));
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const external = [];
  const errors = [];
  const assets = new Set();
  page.on('request', (request) => {
    assets.add(new URL(request.url()).pathname);
    if (request.url().startsWith('http') && new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
    if (request.method() !== 'GET') external.push(request.method());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(msg.text()); });
  page.setDefaultTimeout(45_000);
  await page.goto(base);
  await page.getByRole('button', { name: 'Try a sample NDA' }).click();
  await page.locator('#review').waitFor();
  assert.match(await page.locator('#status').innerText(), /proposed marks/);
  assert.ok(await page.locator('#boxes button').count() >= 2);
  assert.equal(await page.locator('#download').isDisabled(), true);
  await page.locator('#reviewed').check();
  await page.locator('#preview').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#download').isDisabled(), true);
  await page.getByRole('button', { name: /Remove mark.*Manual/ }).click();
  await page.locator('#reviewed').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  const filename = join(dir, 'web-nda.pdf');
  await download.saveAs(filename);
  await assertRasterPdf((await readFile(filename)).toString('base64'));
  const py = process.env.CLEARCOPY_PYTHON ?? '.venv/bin/python';
  execFileSync(py, ['test/native_evidence.py', '--verify-web', filename], { stdio: 'inherit' });
  for (const model of ['nano', 'small', 'medium', 'large']) {
    await page.locator('#model').selectOption(model);
    await page.locator('#source').fill(`For this agreement contact Daniel Harper at daniel.harper@example.com. Model: ${model}.`);
    await page.locator('#mask').click();
    await page.locator('#masked').waitFor();
    const text = await page.locator('#masked').inputValue();
    assert.ok(!text.includes('Daniel Harper') && !text.includes('daniel.harper@example.com'), model);
    assert.ok([...assets].some((asset) => asset.startsWith(`/vendor/model/${model}/onnx/`)), model);
  }
  await page.locator('#prompt-approved').check();
  await page.locator('#masked').fill((await page.locator('#masked').inputValue()) + ' Summarize this.');
  assert.equal(await page.locator('#prompt-approved').isChecked(), false);
  await page.locator('#masked').evaluate((field) => {
    field.value = 'x'.repeat(100_001);
    field.dispatchEvent(new Event('input'));
  });
  assert.equal(await page.locator('#prompt-approved').isDisabled(), true);
  await page.locator('#ocr').selectOption('hr');
  await page.locator('#file').setInputFiles('examples/nda/nda-before.pdf');
  await page.locator('#review').waitFor();
  await page.locator('#reviewed').check();
  assert.equal(await page.locator('#download').isDisabled(), true);
  await page.locator('#next').click();
  await page.locator('#reviewed').check();
  const [scanDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  const scanFile = join(dir, 'web-scanned-nda.pdf');
  await scanDownload.saveAs(scanFile);
  execFileSync(py, ['test/native_evidence.py', '--verify-web-scan', scanFile], { stdio: 'inherit' });
  assert.equal(await page.locator('#share').isVisible(), false);
  await page.locator('#language').click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('html').getAttribute('lang'), 'hr');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log('Desktop Chromium: four models, text and scanned PDF export, HR/EN OCR and zero external requests. HR mobile layout fits.');
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
