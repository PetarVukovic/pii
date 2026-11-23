import { DurableObject } from 'cloudflare:workers';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { bundleSchema, ID, readLimited, serialize } from './bundle.mjs';
import { createMcp } from './mcp.mjs';
import { NO_STORE, SECURITY_HEADERS } from './headers.mjs';
import { assertRasterPdf } from './raster-pdf.mjs';

const TTL = 10 * 60 * 1000;
const CHUNK = 48_000;
const missing = () => new Response(null, { status: 404, headers: NO_STORE });

export class Share extends DurableObject {
  async fetch(request) {
    if (request.method === 'PUT') {
      const body = await request.text();
      const expires = Date.now() + TTL;
      await this.ctx.storage.transaction(async (tx) => {
        await tx.setAlarm(expires);
        await tx.put('expires', expires);
        for (let i = 0; i < body.length; i += CHUNK) {
          await tx.put(`part:${String(i).padStart(8, '0')}`, body.slice(i, i + CHUNK));
        }
      });
      return new Response(null, { status: 201 });
    }
    if (request.method !== 'POST') return missing();
    const body = await this.ctx.storage.transaction(async (tx) => {
      const expires = await tx.get('expires');
      if (!expires || Date.now() >= expires) return null;
      const parts = await tx.list({ prefix: 'part:' });
      for (const key of parts.keys()) await tx.delete(key);
      await tx.delete('expires');
      return [...parts.values()].join('');
    });
    return body ? new Response(body, { headers: NO_STORE }) : missing();
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/capabilities') return Response.json({ remoteShare: env.REMOTE_SHARE === 'on' }, { headers: NO_STORE });
    if (url.pathname === '/api/share') {
      if (env.REMOTE_SHARE !== 'on') return missing();
      if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin ||
          request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {
        return new Response(null, { status: 403, headers: NO_STORE });
      }
      const rate = await env.SHARE_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'local' });
      if (!rate.success) return new Response(null, { status: 429, headers: NO_STORE });
      let body;
      try {
        const bundle = bundleSchema.parse(JSON.parse(await readLimited(request)));
        await assertRasterPdf(bundle.pdf);
        body = serialize(bundle);
      }
      catch { return new Response('Invalid export', { status: 400, headers: NO_STORE }); }
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const code = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const share = env.SHARES.get(env.SHARES.idFromName(code));
      const response = await share.fetch('https://share.internal/', { method: 'PUT', body });
      if (!response.ok) return new Response(null, { status: 503, headers: NO_STORE });
      return Response.json({ code, expiresIn: TTL / 1000 }, { status: 201, headers: NO_STORE });
    }
    if (url.pathname === '/mcp') {
      const origin = request.headers.get('Origin');
      if (origin && ![url.origin, 'https://chatgpt.com', 'https://claude.ai'].includes(origin)) {
        return new Response(null, { status: 403, headers: NO_STORE });
      }
      if (request.method === 'POST') {
        try { request = new Request(request, { body: await readLimited(request.clone()) }); }
        catch { return new Response(null, { status: 400, headers: NO_STORE }); }
      }
      const server = createMcp(async (code) => {
        if (env.REMOTE_SHARE !== 'on' || !ID.test(code)) return;
        const response = await env.SHARES.get(env.SHARES.idFromName(code)).fetch('https://share.internal/', { method: 'POST' });
        return response.ok ? response.json() : undefined;
      }, 'remote');
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      // Stateless JSON responses are complete before the transport is closed.
      await server.close();
      return response;
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
