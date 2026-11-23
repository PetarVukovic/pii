import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function createHostedPlugin(endpoint, directory) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) {
    throw new Error('Use your deployed HTTPS endpoint ending in /mcp.');
  }
  const target = resolve(directory ?? 'clearcopy-chatgpt');
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('plugin.json', root), 'utf8'));
  manifest.description = 'Redeem a one-time code for a ClearCopy export the user reviewed locally.';
  await mkdir(target);
  await Promise.all([
    cp(new URL('skills', root), resolve(target, 'skills'), { recursive: true }),
    cp(new URL('LICENSE', root), resolve(target, 'LICENSE')),
    writeFile(resolve(target, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n'),
    writeFile(resolve(target, 'mcp.json'), JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { clearcopy: { type: 'http', url: url.href } },
    }, null, 2) + '\n'),
  ]);
  process.stdout.write(`Hosted plugin generated in ${target}\n`);
}
