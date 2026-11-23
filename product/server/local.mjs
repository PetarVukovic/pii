import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { bundleSchema, ID, MAX_BODY, serialize } from './bundle.mjs';
import { createMcp } from './mcp.mjs';
import { assertRasterPdf } from './raster-pdf.mjs';

const inbox = process.env.CLEARCOPY_INBOX ?? join(homedir(), '.clearcopy', 'approved');
const destination = (id) => join(inbox, `${id}.json`);

async function readBundle(path) {
  if (!(await lstat(path)).isFile()) throw new Error('Invalid export');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const { size, mode } = await file.stat();
    if (size > MAX_BODY || (mode & constants.S_IFMT) !== constants.S_IFREG) throw new Error('Invalid export');
    const data = Buffer.alloc(size + 1);
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    if (bytesRead !== size) throw new Error('Invalid export');
    const bundle = bundleSchema.parse(JSON.parse(data.subarray(0, bytesRead).toString('utf8')));
    await assertRasterPdf(bundle.pdf);
    return bundle;
  } finally {
    await file.close();
  }
}

try {
  const [command, value] = process.argv.slice(2);
  if (command === 'import' && value) {
    const bundle = await readBundle(value);
    const code = randomBytes(24).toString('hex');
    await mkdir(inbox, { recursive: true, mode: 0o700 });
    await writeFile(destination(code), serialize(bundle), { mode: 0o600, flag: 'wx' });
    process.stdout.write(`${code}\n`);
  } else if (command === 'revoke' && ID.test(value ?? '')) {
    await unlink(destination(value));
  } else if (!command) {
    await createMcp((code) => readBundle(destination(code)), 'local').connect(new StdioServerTransport());
  } else {
    throw new Error('Invalid command');
  }
} catch {
  process.stderr.write('ClearCopy command failed. Use an approved ClearCopy bundle or a valid export code.\n');
  process.exitCode = 1;
}
