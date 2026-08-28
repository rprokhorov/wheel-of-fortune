const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../js/core.js');

const TAU = Math.PI * 2;

test('normalizeAngle приводит угол к [0, 2π)', () => {
  assert.equal(core.normalizeAngle(0), 0);
  assert.ok(Math.abs(core.normalizeAngle(TAU) - 0) < 1e-9);
  assert.ok(Math.abs(core.normalizeAngle(TAU * 3) - 0) < 1e-9);
  assert.ok(Math.abs(core.normalizeAngle(-Math.PI) - Math.PI) < 1e-9);

  // Отрицательные углы не должны давать отрицательный результат
  for (const a of [-0.1, -TAU, -TAU * 2.5, -100]) {
    const n = core.normalizeAngle(a);
    assert.ok(n >= 0 && n < TAU, `normalizeAngle(${a}) = ${n} вне диапазона`);
  }
});

test('победитель всегда оказывается под указателем', () => {
  // Главная гарантия продукта: какой сектор выбран кодом, тот и
  // показывается пользователю. Перебираем все размеры и все индексы.
  for (const total of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 29, 30]) {
    for (let winner = 0; winner < total; winner++) {
      for (const duration of [1, 5, 12, 20]) {
        const turns = core.turnsForDuration(duration);
        const to = core.targetRotation(winner, total, 0, turns);
        const landed = core.sectorAt(core.normalizeAngle(to), total);

        assert.equal(landed, winner,
          `список ${total}, победитель ${winner}, ${duration}с → выпал ${landed}`);
      }
    }
  }
});

test('победитель совпадает и при ненулевом стартовом угле', () => {
  // Второй и последующие розыгрыши стартуют с угла предыдущего
  for (const total of [3, 6, 8, 13]) {
    for (let winner = 0; winner < total; winner++) {
      for (const from of [0.3, 1.7, Math.PI, TAU - 0.01, TAU * 2 + 1]) {
        const to = core.targetRotation(winner, total, from, core.turnsForDuration(20));
        assert.equal(core.sectorAt(core.normalizeAngle(to), total), winner,
          `список ${total}, победитель ${winner}, старт ${from.toFixed(2)}`);
      }
    }
  }
});

test('колесо всегда крутится вперёд минимум на два оборота', () => {
  for (const total of [2, 5, 9]) {
    for (let winner = 0; winner < total; winner++) {
      for (const from of [0, 2.5, 10, 100]) {
        const to = core.targetRotation(winner, total, from, core.turnsForDuration(1));
        assert.ok(to > from, `движение назад: from=${from}, to=${to}`);
        assert.ok(to - from >= Math.PI * 4,
          `слишком короткий путь: ${((to - from) / TAU).toFixed(2)} оборота`);
      }
    }
  }
});

test('число оборотов растёт вместе с длительностью', () => {
  const short = core.turnsForDuration(1);
  const mid = core.turnsForDuration(10);
  const long = core.turnsForDuration(20);

  assert.ok(short >= 3, 'минимум три оборота даже на секунде');
  assert.ok(mid > short);
  assert.ok(long > mid);
});

test('sectorAt устойчив к пустому списку', () => {
  assert.equal(core.sectorAt(0, 0), -1);
  assert.equal(core.sectorAt(1.5, 0), -1);
});

test('sectorAt на границах секторов не выходит за пределы списка', () => {
  const total = 7;
  const slice = TAU / total;
  // Проверяем точно на стыках, где легко промахнуться на единицу
  for (let i = 0; i < total; i++) {
    for (const eps of [-1e-6, 0, 1e-6]) {
      const idx = core.sectorAt(core.normalizeAngle(-i * slice + eps), total);
      assert.ok(idx >= 0 && idx < total, `индекс ${idx} вне диапазона`);
    }
  }
});

test('easeOutQuint замедляется к концу', () => {
  assert.equal(core.easeOutQuint(0), 0);
  assert.equal(core.easeOutQuint(1), 1);

  // Монотонный рост
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const v = core.easeOutQuint(Math.min(t, 1));
    assert.ok(v >= prev, `не монотонна на t=${t.toFixed(2)}`);
    prev = v;
  }

  // Первая половина времени проходит большую часть пути — это и есть
  // ощущение «резко разогналось, потом медленно доезжает»
  assert.ok(core.easeOutQuint(0.5) > 0.9);
});
