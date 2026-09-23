const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function startCollector(t, extraEnv = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wheel-security-'));
  const dbPath = path.join(directory, 'analytics.db');
  const password = 'fixture:password';
  const child = spawn(process.execPath, [path.join(__dirname, '../collector/server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DB_PATH: dbPath,
      ORG_SALT: 'fixture-salt', DASH_USER: 'test', DASH_PASS: password,
      TRUST_PROXY: '0', SITE_ORIGIN: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(timer);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  };
  if (t) t.after(close);
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Collector startup timeout')), 5000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Collector exited')); });
    child.stdout.on('data', data => {
      const match = String(data).match(/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  }).catch(async err => { await close(); throw err; });
  return { base, dbPath, close, child,
    auth: { Authorization: `Basic ${Buffer.from(`test:${password}`).toString('base64')}` } };
}

module.exports = { startCollector };
