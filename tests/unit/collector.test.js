const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../../collector/lib.js');

test.describe('orgIdFrom', () => {
  test('одинаковый IP даёт одинаковый хеш', () => {
    // На этом держится группировка «люди из одного офиса»
    const a = lib.orgIdFrom('195.238.73.62', 'salt');
    const b = lib.orgIdFrom('195.238.73.62', 'salt');
    assert.equal(a, b);
  });

  test('разные IP дают разные хеши', () => {
    const a = lib.orgIdFrom('195.238.73.62', 'salt');
    const b = lib.orgIdFrom('195.238.73.63', 'salt');
    assert.notEqual(a, b);
  });

  test('соль меняет результат', () => {
    // Поэтому её нельзя менять после запуска: старые и новые события
    // перестанут группироваться вместе
    const a = lib.orgIdFrom('1.2.3.4', 'salt-one');
    const b = lib.orgIdFrom('1.2.3.4', 'salt-two');
    assert.notEqual(a, b);
  });

  test('хеш имеет фиксированную длину и не содержит IP', () => {
    const hash = lib.orgIdFrom('195.238.73.62', 'salt');
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]+$/);
    assert.ok(!hash.includes('195'), 'в хеше не должно быть исходного адреса');
  });

  test('без IP возвращает null', () => {
    assert.equal(lib.orgIdFrom(null, 'salt'), null);
    assert.equal(lib.orgIdFrom('', 'salt'), null);
    assert.equal(lib.orgIdFrom(undefined, 'salt'), null);
  });
});

test.describe('clientIp', () => {
  const req = (headers, remote) => ({ headers, socket: { remoteAddress: remote } });

  test('берёт первый адрес из X-Forwarded-For', () => {
    // Caddy добавляет свой адрес в конец, исходный клиент — первый
    assert.equal(
      lib.clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, '10.0.0.1')),
      '203.0.113.7');
  });

  test('падает обратно на адрес сокета', () => {
    assert.equal(lib.clientIp(req({}, '198.51.100.5')), '198.51.100.5');
    assert.equal(lib.clientIp(req({ 'x-forwarded-for': '' }, '198.51.100.5')), '198.51.100.5');
  });

  test('устойчив к отсутствию данных', () => {
    assert.equal(lib.clientIp(req({}, undefined)), null);
    assert.equal(lib.clientIp(undefined), null);
  });
});

test.describe('parseUa', () => {
  const cases = [
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537', 'chrome', 'macos', 0],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537', 'chrome', 'windows', 0],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/17 Safari/605', 'safari', 'macos', 0],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17 Mobile Safari/604', 'safari', 'ios', 1],
    ['Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537', 'chrome', 'android', 1],
    ['Mozilla/5.0 (X11; Linux x86_64) Firefox/121', 'firefox', 'linux', 0],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120', 'edge', 'windows', 0],
    ['Mozilla/5.0 (Windows NT 10.0) YaBrowser/24.1 Safari/537', 'yandex', 'windows', 0]
  ];

  for (const [ua, browser, os, mobile] of cases) {
    test(`${browser} / ${os}${mobile ? ' (мобильный)' : ''}`, () => {
      const parsed = lib.parseUa(ua);
      assert.equal(parsed.browser, browser);
      assert.equal(parsed.os, os);
      assert.equal(parsed.mobile, mobile);
    });
  }

  test('Edge определяется раньше Chrome', () => {
    // Edge содержит и Chrome, и Safari в строке — порядок проверок важен
    const ua = 'Mozilla/5.0 Chrome/120 Safari/537 Edg/120';
    assert.equal(lib.parseUa(ua).browser, 'edge');
  });

  test('пустой UA не роняет разбор', () => {
    assert.deepEqual(lib.parseUa(null), { browser: null, os: null, mobile: 0 });
    assert.deepEqual(lib.parseUa(''), { browser: null, os: null, mobile: 0 });
  });

  test('неизвестный UA даёт other', () => {
    const parsed = lib.parseUa('SomeBot/1.0');
    assert.equal(parsed.browser, 'other');
    assert.equal(parsed.os, 'other');
  });
});

test.describe('hostOf', () => {
  test('извлекает домен', () => {
    assert.equal(lib.hostOf('https://t.me/somechat'), 't.me');
    assert.equal(lib.hostOf('https://mail.google.com/mail/u/0'), 'mail.google.com');
  });

  test('мусорный адрес даёт null, а не исключение', () => {
    for (const bad of ['не адрес', '', null, undefined, 'javascript:alert(1)']) {
      assert.doesNotThrow(() => lib.hostOf(bad));
    }
    assert.equal(lib.hostOf('не адрес'), null);
    assert.equal(lib.hostOf(''), null);
  });
});

test.describe('normalizeProfile', () => {
  test('пропускает известные числовые признаки', () => {
    const out = JSON.parse(lib.normalizeProfile({
      n: 4, len_avg: 6, looks_like_names: 1, pct_cyrillic: 100
    }));
    assert.deepEqual(out, { n: 4, len_avg: 6, looks_like_names: 1, pct_cyrillic: 100 });
  });

  test('отбрасывает строки — имя не может просочиться через профиль', () => {
    // Главная защита: подменённый клиент не протащит текст на сервер
    const out = JSON.parse(lib.normalizeProfile({
      n: 3, secret: 'Вася Пупкин', len_avg: 5
    }));
    assert.deepEqual(out, { n: 3, len_avg: 5 });
    assert.ok(!JSON.stringify(out).includes('Вася'));
  });

  test('отбрасывает неизвестные ключи', () => {
    const out = JSON.parse(lib.normalizeProfile({ n: 2, unknown_key: 42 }));
    assert.deepEqual(out, { n: 2 });
  });

  test('округляет дробные', () => {
    const out = JSON.parse(lib.normalizeProfile({ n: 3, len_avg: 6.7 }));
    assert.equal(out.len_avg, 7);
  });

  test('пустое и нечитаемое даёт null', () => {
    assert.equal(lib.normalizeProfile(null), null);
    assert.equal(lib.normalizeProfile({}), null);
    assert.equal(lib.normalizeProfile('строка'), null);
    assert.equal(lib.normalizeProfile([1, 2, 3]), null);
    assert.equal(lib.normalizeProfile({ secret: 'только строка' }), null);
  });
});

test.describe('normalizeItems', () => {
  test('сохраняет варианты как JSON-массив', () => {
    assert.deepEqual(
      JSON.parse(lib.normalizeItems(['Костя', 'Вася'])),
      ['Костя', 'Вася']);
  });

  test('обрезает длинные строки до 60 символов', () => {
    // Защита от вставки полотна текста в одно событие
    const long = 'Я'.repeat(300);
    const out = JSON.parse(lib.normalizeItems([long]));
    assert.equal(out[0].length, 60);
  });

  test('ограничивает список 30 позициями', () => {
    const many = Array.from({ length: 100 }, (_, i) => `Вариант ${i}`);
    assert.equal(JSON.parse(lib.normalizeItems(many)).length, 30);
  });

  test('обрезает пробелы и убирает пустые', () => {
    assert.deepEqual(
      JSON.parse(lib.normalizeItems(['  Костя  ', '', '   ', 'Вася'])),
      ['Костя', 'Вася']);
  });

  test('не массив или пусто — null', () => {
    assert.equal(lib.normalizeItems(null), null);
    assert.equal(lib.normalizeItems([]), null);
    assert.equal(lib.normalizeItems('строка'), null);
    assert.equal(lib.normalizeItems(['', '  ']), null);
  });
});

test.describe('normalizeProps', () => {
  test('пропускает известные ключи', () => {
    const out = lib.normalizeProps({ duration_s: 20, music: 'benny', sound_on: true });
    assert.deepEqual(out, { duration_s: 20, music: 'benny', sound_on: 1 });
  });

  test('отбрасывает неизвестные ключи', () => {
    assert.deepEqual(lib.normalizeProps({ music: 'none', hack: 'value' }), { music: 'none' });
  });

  test('обрезает длинные строки', () => {
    const out = lib.normalizeProps({ message: 'ошибка '.repeat(100) });
    assert.ok(out.message.length <= 200);
  });

  test('пустой ввод даёт пустой объект', () => {
    assert.deepEqual(lib.normalizeProps(null), {});
    assert.deepEqual(lib.normalizeProps('строка'), {});
  });
});

test.describe('EVENTS', () => {
  test('содержит все события, которые шлёт клиент', () => {
    for (const name of ['page_view', 'spin_start', 'spin_complete', 'spin_abandon',
      'decision', 'items_changed', 'link_copied', 'music_changed',
      'duration_changed', 'audio_blocked', 'error']) {
      assert.ok(lib.EVENTS.has(name), `нет события ${name}`);
    }
  });

  test('не содержит посторонних', () => {
    assert.ok(!lib.EVENTS.has('unknown_event'));
    assert.ok(!lib.EVENTS.has('drop_table'));
  });
});
