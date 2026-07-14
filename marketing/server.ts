const port = Number(process.env.PORT) || 3002;
const root = new URL('./', import.meta.url).pathname;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = Bun.file(root + pathname.slice(1));
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    const ext = pathname.slice(pathname.lastIndexOf('.'));
    return new Response(file, { headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' } });
  }
});

console.log(`SpecProof marketing site → http://localhost:${port}`);
