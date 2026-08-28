const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../js/core.js');

const TRACKS = { none: {}, kalambur: {}, nupogodi: {}, benny: {} };
const DEFAULTS = {
  items: ['A', 'B'], duration: 20, music: 'kalambur', volume: 50, sound: true
};

test.describe('clampInt', () => {
  test('пустые значения дают null, а не ноль', () => {
    // Number(null) === 0, поэтому без явной проверки отсутствующий
    // параметр молча превращался бы в минимум диапазона
    for (const empty of [null, undefined, '']) {
      assert.equal(core.clampInt(empty, 1, 20), null,
        `${JSON.stringify(empty)} должен дать null`);
    }
  });

  test('нечисловые значения дают null', () => {
    for (const bad of ['abc', 'twenty', {}, [], NaN, Infinity, '12abc']) {
      assert.equal(core.clampInt(bad, 1, 20), null,
        `${JSON.stringify(bad)} должен дать null`);
    }
  });

  test('значения зажимаются в диапазон', () => {
    assert.equal(core.clampInt(999, 1, 20), 20);
    assert.equal(core.clampInt(-40, 0, 100), 0);
    assert.equal(core.clampInt(0, 1, 20), 1);
    assert.equal(core.clampInt(7, 1, 20), 7);
  });

  test('дробные округляются', () => {
    assert.equal(core.clampInt('7.4', 1, 20), 7);
    assert.equal(core.clampInt('7.6', 1, 20), 8);
  });
});

test.describe('isTruthy', () => {
  test('распознаёт истинные написания', () => {
    for (const v of ['1', 'true', 'yes', 'on']) {
      assert.equal(core.isTruthy(v), true, `${v} должно быть истиной`);
    }
  });

  test('всё прочее — ложь', () => {
    for (const v of ['0', 'false', 'no', 'off', '', 'maybe', null, undefined]) {
      assert.equal(core.isTruthy(v), false, `${JSON.stringify(v)} должно быть ложью`);
    }
  });
});

test.describe('parseItems', () => {
  test('разделяет по строкам, запятым и точкам с запятой', () => {
    assert.deepEqual(core.parseItems('Раз\nДва'), ['Раз', 'Два']);
    assert.deepEqual(core.parseItems('Раз, Два'), ['Раз', 'Два']);
    assert.deepEqual(core.parseItems('Раз; Два'), ['Раз', 'Два']);
    assert.deepEqual(core.parseItems('Раз, Два; Три\nЧетыре'),
      ['Раз', 'Два', 'Три', 'Четыре']);
  });

  test('обрезает пробелы и отбрасывает пустые', () => {
    assert.deepEqual(core.parseItems('  Раз  \n\n  Два  '), ['Раз', 'Два']);
    assert.deepEqual(core.parseItems('Раз,,,Два'), ['Раз', 'Два']);
    assert.deepEqual(core.parseItems('   \n  \t '), []);
  });

  test('отсеивает дубликаты без учёта регистра', () => {
    assert.deepEqual(core.parseItems('Вася\nвася\nВАСЯ\nПетя'), ['Вася', 'Петя']);
    // Сохраняется первое написание
    assert.deepEqual(core.parseItems('вася\nВася'), ['вася']);
  });

  test('дубликаты ловятся и в латинице', () => {
    assert.deepEqual(core.parseItems('Pizza\npizza\nPIZZA'), ['Pizza']);
  });

  test('список ограничен 30 вариантами', () => {
    const many = Array.from({ length: 100 }, (_, i) => `Вариант ${i}`).join('\n');
    assert.equal(core.parseItems(many).length, 30);
  });

  test('устойчив к пустому и странному вводу', () => {
    assert.deepEqual(core.parseItems(''), []);
    assert.deepEqual(core.parseItems(null), []);
    assert.deepEqual(core.parseItems(undefined), []);
  });

  test('эмодзи и знаки сохраняются как есть', () => {
    assert.deepEqual(core.parseItems('🍕 Пицца\n☕ Кофе'), ['🍕 Пицца', '☕ Кофе']);
  });
});

test.describe('readState', () => {
  test('без параметров возвращает значения по умолчанию', () => {
    const s = core.readState('', TRACKS, DEFAULTS);
    assert.deepEqual(s, DEFAULTS);
  });

  test('читает все параметры', () => {
    const s = core.readState(
      '?items=Костя,Вася&duration=5&music=nupogodi&volume=70&sound=0',
      TRACKS, DEFAULTS);

    assert.deepEqual(s.items, ['Костя', 'Вася']);
    assert.equal(s.duration, 5);
    assert.equal(s.music, 'nupogodi');
    assert.equal(s.volume, 70);
    assert.equal(s.sound, false);
  });

  test('некорректные значения зажимаются, а не ломают состояние', () => {
    const s = core.readState(
      '?duration=999&volume=-40&music=несуществующий', TRACKS, DEFAULTS);

    assert.equal(s.duration, 20, 'длительность зажата максимумом');
    assert.equal(s.volume, 0, 'громкость зажата минимумом');
    assert.equal(s.music, 'none', 'неизвестный трек → без музыки');
  });

  test('мусор в параметрах не сбрасывает умолчания', () => {
    const s = core.readState('?duration=abc&volume=xyz', TRACKS, DEFAULTS);
    assert.equal(s.duration, DEFAULTS.duration);
    assert.equal(s.volume, DEFAULTS.volume);
  });

  test('пустой items — валидное состояние', () => {
    const s = core.readState('?items=', TRACKS, DEFAULTS);
    assert.deepEqual(s.items, []);
  });

  test('не переданные параметры не трогают остальные', () => {
    const s = core.readState('?duration=7', TRACKS, DEFAULTS);
    assert.equal(s.duration, 7);
    assert.equal(s.music, DEFAULTS.music);
    assert.deepEqual(s.items, DEFAULTS.items);
  });
});

test.describe('buildQuery и круговой обход', () => {
  test('состояние переживает запись и чтение', () => {
    const cases = [
      { items: ['Пицца', 'Суши', 'Кофе с молоком'], duration: 20, music: 'kalambur', volume: 60, sound: true },
      { items: ['A'], duration: 1, music: 'none', volume: 0, sound: false },
      { items: ['X', 'Y'], duration: 20, music: 'benny', volume: 100, sound: true }
    ];

    for (const original of cases) {
      const restored = core.readState('?' + core.buildQuery(original), TRACKS, DEFAULTS);
      assert.deepEqual(restored, original,
        `не совпало для ${JSON.stringify(original.items)}`);
    }
  });

  test('кириллица кодируется и восстанавливается', () => {
    const qs = core.buildQuery({
      items: ['Костя', 'Вася'], duration: 5, music: 'none', volume: 50, sound: true
    });
    assert.ok(qs.includes('%D0'), 'кириллица должна быть закодирована');
    assert.deepEqual(core.readState('?' + qs, TRACKS, DEFAULTS).items, ['Костя', 'Вася']);
  });

  test('в строке присутствуют все ключи', () => {
    const qs = core.buildQuery(DEFAULTS);
    for (const key of ['items', 'duration', 'music', 'volume', 'sound']) {
      assert.ok(qs.includes(key + '='), `нет ключа ${key}`);
    }
  });
});
