import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve('dist');
const types = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.mjs': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store');
    const file = path.resolve(
      root,
      decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1)),
    );
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const bytes = await fs.readFile(file);
    response.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? 'Port 4187 is already in use.' : error.message);
  process.exitCode = 1;
});
server.listen(4187, '127.0.0.1', () => console.log('DNV local demo: http://127.0.0.1:4187/'));
