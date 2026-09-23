// Изолированная проверка настоящего Compose: отдельные порты, сеть и тома.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wheel-smoke-'));
const project = `wheel-smoke-${crypto.randomBytes(4).toString('hex')}`;
const password = crypto.randomBytes(24).toString('hex');
const env = { ...process.env, SITE_DOMAIN: 'localhost', ACME_EMAIL: 'test@example.com',
  ORG_SALT: crypto.randomBytes(32).toString('hex'), DASH_USER: 'test', DASH_PASS: password, TAG: 'security-audit' };
const docker = args => execFileSync('docker', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const compose = args => docker(['compose', '-p', project, '-f', path.join(directory, 'compose.json'), ...args]);
let started = false;
try {
  const config = JSON.parse(docker(['compose', '-f', 'docker-compose.yml', 'config', '--format', 'json']));
  config.name = project;
  for (const [name, volume] of Object.entries(config.volumes)) volume.name = `${project}_${name}`;
  for (const [name, network] of Object.entries(config.networks)) network.name = `${project}_${name}`;
  for (const [name, service] of Object.entries(config.services)) {
    delete service.container_name;
    delete service.build;
    service.image = name === 'site' ? 'wheel-site:security-audit' : name === 'caddy'
      ? 'wheel-proxy:security-audit' : 'wheel-collector:security-audit';
  }
  config.services.caddy.ports = [{ target: 443, published: '0', host_ip: '127.0.0.1', protocol: 'tcp' }];
  const caddyfile = fs.readFileSync(path.join(root, 'caddy/Caddyfile'), 'utf8')
    .replace('{$SITE_DOMAIN} {', '{$SITE_DOMAIN} {\n\ttls internal');
  fs.writeFileSync(path.join(directory, 'Caddyfile'), caddyfile);
  config.services.caddy.volumes.find(v => v.target === '/etc/caddy/Caddyfile').source = path.join(directory, 'Caddyfile');
  fs.writeFileSync(path.join(directory, 'compose.json'), JSON.stringify(config), { mode: 0o600 });
  started = true;
  compose(['up', '-d', '--no-build']);
  const port = Number(compose(['port', 'caddy', '443']).split(':').at(-1));
  function request(route, { method = 'GET', headers = {}, body = '' } = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request({ hostname: '127.0.0.1', servername: 'localhost', port, path: route,
        rejectUnauthorized: false, method, headers: { Host: 'localhost', ...headers } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.setTimeout(3000, () => req.destroy(new Error('HTTPS timeout')));
      req.on('error', reject);
      req.end(body);
    });
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/api/health')).status === 200) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'HTTPS через Caddy и коллектор');
  const site = await request('/?items=private-list-marker');
  assert.equal(site.status, 200);
  assert.match(site.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(site.headers['strict-transport-security'], 'max-age=31536000');
  assert.equal((await request('/.env')).status, 404);
  for (const route of ['/api/stats', '/api/sessions', '/api/dashboard', '/api/assets/dashboard.js']) {
    assert.equal((await request(route)).status, 401);
  }
  assert.equal((await request('/api/e', { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: 'https://localhost',
    'X-Real-IP': '203.0.113.77', 'X-Forwarded-For': '203.0.113.77'
  }, body: JSON.stringify({ events: [{ name: 'page_view', session_id: 'smoke', visitor_id: 'smoke' }] }) })).status, 204);
  const auth = { Authorization: `Basic ${Buffer.from(`test:${password}`).toString('base64')}` };
  const sessions = await request('/api/sessions', { headers: auth });
  assert.equal(sessions.status, 200);
  assert.equal(JSON.parse(sessions.body).count, 1);
  assert.notEqual(JSON.parse(sessions.body).sessions[0].ip, '203.0.113.77', 'Caddy перезаписал подставленный IP');
  const backup = compose(['exec', '-T', 'collector', 'node', '-e', `
    const D=require('better-sqlite3');
    const db=new D(process.env.DB_PATH);
    db.backup('/data/smoke-backup.db').then(() => {
      const copy=new D('/data/smoke-backup.db');
      if(copy.pragma('integrity_check',{simple:true})!=='ok'||copy.prepare('SELECT count(*) n FROM events').get().n!==1) process.exit(1);
      console.log('backup-ok');
    });`]);
  assert.equal(backup, 'backup-ok');
  compose(['exec', '-T', 'collector', 'node', 'rollup.js']);
  // Проверяем переход существующего тома с root на UID 1000 и сохранение данных.
  compose(['stop', 'collector', 'rollup']);
  for (const owner of ['0:0', '1000:1000']) {
    compose(['run', '--rm', '--no-deps', '--user', '0', '--cap-add', 'CHOWN',
      '--entrypoint', 'chown', 'collector', '-R', owner, '/data']);
  }
  compose(['up', '-d', '--no-deps', 'collector', 'rollup']);
  let preserved = false;
  for (let i = 0; i < 100; i++) {
    try {
      const result = await request('/api/sessions', { headers: auth });
      if (result.status === 200 && JSON.parse(result.body).count === 1) { preserved = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(preserved, 'Данные сохранены после смены владельца и перезапуска');
  for (const service of ['site', 'collector']) {
    assert.notEqual(compose(['exec', '-T', service, 'id', '-u']), '0');
  }
  const logs = compose(['logs', '--no-color', 'caddy', 'site']);
  assert.ok(!logs.includes('private-list-marker'), 'Содержимое URL не попало в журналы');
  console.log('Контейнеры: HTTPS, CSP/HSTS, авторизация, запись, защита IP, backup, миграция тома, rollup и запуск без root — OK');
} finally {
  // Только созданный этой проверкой проект; рабочие тома не затрагиваются.
  if (started) compose(['down', '--volumes', '--remove-orphans']);
  fs.rmSync(directory, { recursive: true, force: true });
}
