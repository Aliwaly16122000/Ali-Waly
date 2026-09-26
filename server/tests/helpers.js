import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Starts a real server on a free port with a fresh seeded database in a temp dir. */
export async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engportal-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), NODE_ENV: 'test' };
  execFileSync(process.execPath, ['src/seed.js'], { cwd: serverDir, env, stdio: 'ignore' });
  const proc = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    dataDir,
    log: () => log,
    stop() {
      proc.kill();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** A logged-in API client that keeps its session cookie. */
export async function client(base, username, password) {
  let cookie = '';
  const call = async (method, url, body) => {
    const headers = { cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  };
  const api = {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b ?? {}),
    put: (u, b) => call('PUT', u, b ?? {}),
    del: (u) => call('DELETE', u),
  };
  if (username) {
    const r = await api.post('/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(r.data)}`);
    api.user = r.data.user;
  }
  return api;
}

export const pdf = (name = 'solution.pdf') => {
  const fd = new FormData();
  fd.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), name);
  return fd;
};
