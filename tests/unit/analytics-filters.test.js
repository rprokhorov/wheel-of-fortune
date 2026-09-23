const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Database = require('../../collector/node_modules/better-sqlite3');

const collector = path.join(__dirname, '../../collector');

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

test('выбранная музыка и решение ограничивают свой график даже при нескольких значениях в сессии', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wheel-analytics-filter-'));
  const dbPath = path.join(directory, 'analytics.db');
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(path.join(collector, 'schema.sql'), 'utf8'));
  const insert = db.prepare(`INSERT INTO events (ts, day, name, visitor_id, session_id, props)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const day = new Date().toISOString().slice(0, 10);
  const at = `${day}T12:00:00.000Z`;
  for (const [session, name, props] of [
    ['first', 'spin_start', { music: 'kalambur' }],
    ['first', 'spin_start', { music: 'benny' }],
    ['first', 'decision', { choice: 'keep' }],
    ['first', 'decision', { choice: 'remove' }],
    ['second', 'spin_start', { music: 'nupogodi' }],
    ['second', 'decision', { choice: 'keep' }]
  ]) insert.run(at, day, name, session, session, JSON.stringify(props));
  db.close();

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(collector, 'server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: dbPath,
      ORG_SALT: 'test-only', DASH_USER: 'test', DASH_PASS: 'test-only' },
    stdio: 'ignore'
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; }
    } catch (_) { /* коллектор ещё запускается */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'коллектор запустился');
  const stats = async (query) => {
    const response = await fetch(`${base}/api/stats?${query}`, {
      headers: { Authorization: `Basic ${Buffer.from('test:test-only').toString('base64')}` }
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  const all = await stats('days=1');
  assert.deepEqual(new Set(all.music.map(row => row.value)),
    new Set(['kalambur', 'benny', 'nupogodi']));

  const chosenMusic = await stats('days=1&music=kalambur');
  assert.equal(chosenMusic.totals.sessions, 1);
  assert.deepEqual(chosenMusic.music, [{ value: 'kalambur', count: 1 }]);
  assert.deepEqual(new Set(chosenMusic.decisions.map(row => row.value)),
    new Set(['keep', 'remove']));

  const chosenDecision = await stats('days=1&decision=remove');
  assert.equal(chosenDecision.totals.sessions, 1);
  assert.deepEqual(chosenDecision.decisions, [{ value: 'remove', count: 1 }]);
  assert.deepEqual(new Set(chosenDecision.music.map(row => row.value)),
    new Set(['kalambur', 'benny']));
});
