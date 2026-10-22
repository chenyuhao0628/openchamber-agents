// Synthetic SDK host only. Never reads user rules, host settings or credentials.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const routes = new Map([
  ['/', ['scripts/preview.html', 'text/html']],
  ['/preview.js', ['scripts/preview.js', 'text/javascript']],
  ['/preview-navigation.js', ['scripts/preview-navigation.js', 'text/javascript']],
  ['/panel/index.html', ['panel/index.html', 'text/html']],
  ['/panel/section.html', ['panel/section.html', 'text/html']],
  ['/panel/main.js', ['panel/main.js', 'text/javascript']],
  ['/panel/section.js', ['panel/section.js', 'text/javascript']],
]);
const server = createServer(async (req, res) => {
  const route = routes.get(new URL(req.url, 'http://localhost').pathname);
  if (!route || req.method !== 'GET') { res.writeHead(404).end(); return; }
  try { const body = await readFile(fileURLToPath(new URL(route[0], root))); res.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(body); }
  catch { res.writeHead(500).end('Run npm run build first.'); }
});
server.listen(Number(process.env.PREVIEW_PORT ?? 0), '127.0.0.1', () => console.log(`Synthetic preview: http://127.0.0.1:${server.address().port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
