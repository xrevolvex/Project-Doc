'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { scan, probe } = require('./lib/scanner');

const PORT = process.env.PORT || 4477;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- API: scan a folder ----------------------------------------------
  if (url.pathname === '/api/scan' && req.method === 'POST') {
    const { folder } = await readBody(req);
    if (!folder) return sendJSON(res, 400, { error: 'No folder path provided.' });
    let target = folder.trim().replace(/^~(?=\/|$)/, process.env.HOME || '');
    try {
      const stat = fs.statSync(target);
      if (!stat.isDirectory()) return sendJSON(res, 400, { error: 'Path is not a directory.' });
    } catch {
      return sendJSON(res, 400, { error: `Folder not found: ${target}` });
    }
    try {
      const report = scan(target);
      return sendJSON(res, 200, report);
    } catch (e) {
      return sendJSON(res, 500, { error: 'Scan failed: ' + e.message });
    }
  }

  // --- API: live header probe ------------------------------------------
  if (url.pathname === '/api/probe' && req.method === 'POST') {
    const { target } = await readBody(req);
    if (!target) return sendJSON(res, 400, { error: 'No URL provided.' });
    try {
      const findings = await probe(target);
      return sendJSON(res, 200, { findings });
    } catch (e) {
      return sendJSON(res, 500, { error: 'Probe failed: ' + e.message });
    }
  }

  // --- Static files -----------------------------------------------------
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Project Doctor running at  http://localhost:${PORT}\n`);
  console.log('  Open that URL in your browser, paste a project folder path, and run an audit.\n');
});
