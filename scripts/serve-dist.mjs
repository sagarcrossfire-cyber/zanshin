// Serves `dist` the way Netlify will: static files first, then the rules in
// public/_redirects, with the headers from public/_headers applied. Used by
// the CSP end-to-end check (playwright.netlify.config.ts) so a header that
// would break the app is caught before a deploy, not after.
//
//   node scripts/serve-dist.mjs [port] [dir]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 4174);
const dir = resolve(process.argv[3] ?? 'dist');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Parses Netlify's _headers format: a path line, then indented "Name: value" lines. */
function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      current = { headers: [], path: line.trim() };
      rules.push(current);
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx > 0) current.headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    }
  }
  return rules;
}

/** Parses _redirects lines: "from to status". */
function parseRedirects(text) {
  return text.split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [from, to, status] = line.split(/\s+/);
      return { from, status: Number(status ?? 301), to };
    });
}

function matches(pattern, path) {
  if (pattern === path) return true;
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1)) || path === pattern.slice(0, -2);
  return false;
}

const headerRules = existsSync(join(dir, '_headers')) ? parseHeaders(readFileSync(join(dir, '_headers'), 'utf8')) : [];
const redirectRules = existsSync(join(dir, '_redirects')) ? parseRedirects(readFileSync(join(dir, '_redirects'), 'utf8')) : [];

function fileFor(path) {
  const safe = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  const full = join(dir, safe);
  if (!full.startsWith(dir)) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  if (existsSync(join(full, 'index.html'))) return join(full, 'index.html');
  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let path = url.pathname;
  let status = 200;
  let file = fileFor(path);
  if (file === null) {
    const rule = redirectRules.find((r) => matches(r.from, path));
    if (rule) {
      status = rule.status;
      path = rule.to;
      file = fileFor(path);
    }
  }
  for (const rule of headerRules) {
    if (matches(rule.path, url.pathname) || (rule.path === '/' && url.pathname === '/')) {
      for (const [name, value] of rule.headers) res.setHeader(name, value);
    }
  }
  if (file === null) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serve-dist: http://127.0.0.1:${port} from ${dir} (${headerRules.length} header rules, ${redirectRules.length} redirect rules)`);
});
