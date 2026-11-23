import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PDFDocument } from 'pdf-lib';
import { readLimited, serialize } from '../server/bundle.mjs';
import { assertRasterPdf } from '../server/raster-pdf.mjs';

const clean = { version: 1, text: 'Summarize the NDA for [PERSON_1].' };
const cli = fileURLToPath(new URL('../server/cli.mjs', import.meta.url));

test('portable hosted plugin uses the configured HTTPS endpoint and includes the skill', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clearcopy-plugin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = join(dir, 'plugin');
  const make = (url) => execFileSync(process.execPath, [cli, 'chatgpt-plugin', url, out], { stdio: 'pipe' });
  assert.throws(() => make('http://localhost:8795/mcp'));
  make('https://clearcopy.example/mcp');
  const mcp = JSON.parse(await readFile(join(out, 'mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers.clearcopy.url, 'https://clearcopy.example/mcp');
  assert.match(await readFile(join(out, 'skills/clearcopy/SKILL.md'), 'utf8'), /read_approved_export/);
});

test('accept only explicit versioned export data and bound request size', async () => {
  assert.equal(JSON.parse(serialize(clean)).text, clean.text);
  assert.throws(() => serialize({ ...clean, original: 'private' }));
  assert.throws(() => serialize({ version: 1 }));
  assert.throws(() => serialize({ version: 1, pdf: 'not-a-pdf' }));
  assert.throws(() => serialize({ version: 1, pdf: Buffer.from('%PDF-\ninvalid').toString('base64') }));
  await assert.rejects(readLimited(new Request('http://test', { method: 'POST', body: 'x'.repeat(8 * 1024 * 1024 + 1) })));
});

test('PDF imports reject source metadata, attachments and text resources', async () => {
  const source = await readFile(new URL('../examples/nda/nda-before.pdf', import.meta.url));
  await assert.rejects(assertRasterPdf(source.toString('base64')));
  const searchable = await PDFDocument.create({ updateMetadata: false });
  searchable.addPage().drawText('Unreviewed text');
  await assert.rejects(assertRasterPdf(Buffer.from(await searchable.save()).toString('base64')));
  const cleanPdf = await readFile(new URL('../examples/nda/nda-after.pdf', import.meta.url));
  await assertRasterPdf(cleanPdf.toString('base64'));
});

test('local MCP returns approved contents and refuses paths or revoked codes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clearcopy-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { ...process.env, CLEARCOPY_INBOX: join(dir, 'inbox') };
  const file = join(dir, 'reviewed.json');
  await writeFile(file, serialize(clean));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  const code = run('import', file).trim();
  const client = new Client({ name: 'clearcopy-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [cli, 'mcp'], env,
  }));
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), ['read_approved_export']);
  const read = (code) => client.callTool({ name: 'read_approved_export', arguments: { code } });
  assert.equal((await read(code)).content[0].text, clean.text);
  assert.equal((await read('../reviewed.json')).isError, true);
  run('revoke', code);
  assert.equal((await read(code)).isError, true);
});

test('HTTPS-compatible transport redeems at most once and preserves the approved PDF', { skip: !process.env.CLEARCOPY_REMOTE_URL }, async (t) => {
  const url = new URL(process.env.CLEARCOPY_REMOTE_URL);
  const fixture = await readFile(new URL('../examples/nda/nda-after.pdf', import.meta.url));
  const pdf = fixture.toString('base64');
  const share = (origin) => fetch(new URL('/api/share', url), {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: serialize({ ...clean, pdf }),
  });
  assert.equal((await share('https://wrong.invalid')).status, 403);
  const result = await share(url.origin);
  assert.equal(result.status, 201, await result.clone().text());
  const { code, expiresIn } = await result.json();
  assert.equal(expiresIn, 600);
  const client = new Client({ name: 'clearcopy-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', url)));
  t.after(() => client.close());
  const redeem = () => client.callTool({ name: 'read_approved_export', arguments: { code } });
  const responses = await Promise.all([redeem(), redeem()]);
  assert.equal(responses.filter(({ isError }) => isError).length, 1);
  const opened = responses.find(({ isError }) => !isError);
  assert.equal(opened.content[0].text, clean.text);
  assert.equal(opened.content[1].resource.blob, pdf);
});
