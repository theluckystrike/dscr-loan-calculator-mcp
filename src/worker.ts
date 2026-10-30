import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer, SERVER_NAME } from './tools.js';
import { more } from './core.js';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(origin: string): string {
  const url = `${origin}/mcp`;
  const site = more('/dscr-loan-calculator/');
  const tools: [string, string][] = [
    ['calculate_dscr', 'DSCR = qualifying rent / PITIA, exact P&amp;I, interest-only option, lender bands'],
    ['max_loan_for_target_dscr', 'Largest loan that keeps DSCR at or above a target'],
    ['rent_needed_for_target_dscr', 'Smallest rent that reaches a target DSCR'],
    ['compare_scenarios', 'Up to 5 rate, down payment and term scenarios side by side'],
    ['amortization_summary', 'Payment, total interest and balance after N years'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSCR Loan Calculator MCP</title>
<meta name="description" content="Free remote MCP server for DSCR loan math: debt service coverage ratio, max loan, rent needed, scenarios and amortization.">
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;color:#1a1a1a;background:#fff}code,pre{background:#f3f3f3;border-radius:4px;padding:2px 5px;font-size:14px}pre{padding:12px;overflow-x:auto}td{padding:4px 8px;vertical-align:top;border-bottom:1px solid #eee}a{color:#0b57d0}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}code,pre{background:#222}td{border-color:#333}a{color:#8ab4f8}}</style></head><body>
<h1>DSCR Loan Calculator MCP</h1>
<p>Exact DSCR loan math for AI assistants. Rent, PITIA, debt service coverage ratio, lender bands, max loan and rent needed. No sign-in, no token.</p>
<p>MCP endpoint (Streamable HTTP): <code>${esc(url)}</code></p>
<h2>Tools</h2><table>${tools.map(([n, d]) => `<tr><td><code>${n}</code></td><td>${d}</td></tr>`).join('')}</table>
<h2>Install</h2>
<p>Claude.ai custom connector or ChatGPT developer mode: paste <code>${esc(url)}</code>.</p>
<pre>claude mcp add --transport http dscr-loan-calculator ${esc(url)}</pre>
<pre>npx -y github:theluckystrike/${SERVER_NAME}</pre>
<p>Source: <a href="https://github.com/theluckystrike/${SERVER_NAME}">github.com/theluckystrike/${SERVER_NAME}</a>. Calculators and rate pages: <a href="${site}">dscrradar.com</a>.</p>
<p>Lender DSCR minimums vary. Results are math, not a loan approval.</p>
<p>Part of the Zovo MCP collection: <a href="https://mcp.zovo.one">https://mcp.zovo.one</a></p>
</body></html>`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(page(url.origin), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      if (request.method === 'GET' || request.method === 'DELETE') {
        return withCors(new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This server is stateless; use POST.' }, id: null }), { status: 405, headers: { 'content-type': 'application/json', Allow: 'POST' } }));
      }
      const server = createServer();
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      const res = await transport.handleRequest(request);
      return withCors(res);
    }
    return new Response('Not found. The MCP endpoint is /mcp.', { status: 404 });
  },
};
