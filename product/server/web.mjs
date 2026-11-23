import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_STORE, SECURITY_HEADERS } from './headers.mjs';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export async function serve(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port from 1 through 65535.');
  await stat(resolve(dist, 'index.html')).catch(() => { throw new Error('Build the editor with npm run build first.'); });
  const host = `127.0.0.1:${port}`;
  const server = createServer(async (request, response) => {
    const reply = (status, body = '', contentType = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { ...NO_STORE, ...SECURITY_HEADERS, 'Content-Type': contentType });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (request.headers.host !== host) return reply(403);
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405);
    try {
      const path = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
      if (path === '/api/capabilities') return reply(200, '{"remoteShare":false}', 'application/json');
      const file = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
      if (!file.startsWith(`${dist}${sep}`)) return reply(404);
      const entry = await stat(file);
      if (!entry.isFile()) return reply(404);
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Content-Length': entry.size,
        'Cache-Control': path.startsWith('/vendor/') ? 'public, max-age=3600' : 'no-cache',
      });
      if (request.method === 'HEAD') return response.end();
      createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch {
      reply(404);
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  process.stdout.write(`ClearCopy is ready at http://${host}\n`);
}
