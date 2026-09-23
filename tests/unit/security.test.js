const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startCollector } = require('../collector-fixture');

const event = { name: 'page_view', session_id: 'fixture', visitor_id: 'fixture' };
const post = (base, body, headers = {}) => fetch(`${base}/api/e`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

test('закрытые маршруты требуют пароль; двоеточия в пароле поддерживаются', async t => {
  const { base, auth } = await startCollector(t);
  for (const route of ['/api/dashboard', '/api/dashboard/', '/api/assets/echarts.min.js', '/api/assets/dashboard.js', '/api/stats', '/api/sessions']) {
    assert.equal((await fetch(base + route)).status, 401, route);
    const response = await fetch(base + route, { headers: auth });
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('повреждённый URL не завершает процесс коллектора', async t => {
  const { base } = await startCollector(t);
  const status = await new Promise(resolve => {
    const req = http.get(base, { path: '//[' }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve('connection closed'));
  });
  assert.equal(status, 400);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});

test('пачки проверяются до записи; чужой сайт не может отправлять события формой', async t => {
  const { base, auth } = await startCollector(t);
  for (const value of ['{', 'null', '{}', '{"events":{}}']) {
    assert.equal((await post(base, value)).status, 400);
  }
  assert.equal((await post(base, { events: [event] }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(base, { events: [event] }, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await post(base, { events: [event] }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(base, { events: Array(51).fill(event) })).status, 413);
  assert.equal((await post(base, ' '.repeat(65537))).status, 413);
  assert.equal((await post(base, { events: [event] }, { Origin: base })).status, 204);
  const stats = await (await fetch(base + '/api/stats', { headers: auth })).json();
  assert.equal(stats.totals.page_views, 1);
});

test('подставленный X-Forwarded-For не обходит ограничение входа', async t => {
  const { base, auth } = await startCollector(t);
  for (let i = 0; i < 31; i++) {
    assert.equal((await fetch(base + '/api/stats', {
      headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` }
    })).status, i < 30 ? 401 : 429);
  }
  const limited = await fetch(base + '/api/stats', { headers: auth });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});
