#!/usr/bin/env node
const [command, value, directory] = process.argv.slice(2);
if (command === 'web') {
  try {
    const { serve } = await import('./web.mjs');
    await serve(value === undefined ? 8795 : Number(value));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
} else if (command === 'chatgpt-plugin') {
  try {
    const { createHostedPlugin } = await import('./hosted-plugin.mjs');
    await createHostedPlugin(value, directory);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
} else if (['mcp', 'import', 'revoke'].includes(command)) {
  if (command === 'mcp') process.argv.splice(2, 1);
  await import('./local.mjs');
} else {
  process.stdout.write('clearcopy web [port] | mcp | import <approved.json> | revoke <code> | chatgpt-plugin <https://host/mcp> [directory]\n');
  process.exitCode = command && command !== '--help' ? 1 : 0;
}
