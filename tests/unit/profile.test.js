const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../js/core.js');

// profileItems описывает список, не раскрывая его содержимое.
// По этим признакам видно, для чего используют колесо.

test.describe('profileItems', () => {
  test('список имён распознаётся как имена', () => {
    const p = core.profileItems(['Костя', 'Вася', 'Диман', 'Дима']);
    assert.equal(p.looks_like_names, 1);
    assert.equal(p.n, 4);
    assert.equal(p.pct_one_word, 100);
    assert.equal(p.pct_cyrillic, 100);
  });

  test('английские имена тоже распознаются', () => {
    const p = core.profileItems(['Alice', 'Bob', 'Carol', 'Dave']);
    assert.equal(p.looks_like_names, 1);
    assert.equal(p.pct_latin, 100);
    assert.equal(p.pct_cyrillic, 0);
  });

  test('длинные формулировки задач именами не считаются', () => {
    const p = core.profileItems([
      'Разобрать баги в проде',
      'Обновить документацию по API',
      'Провести код-ревью пул-реквестов'
    ]);
    assert.equal(p.looks_like_names, 0);
    assert.ok(p.len_avg > 20);
    assert.ok(p.pct_one_word < 50);
  });

  test('строчные слова именами не считаются', () => {
    // Признак имени — заглавная буква; «пицца» это не имя
    const p = core.profileItems(['пицца', 'суши', 'паста', 'салат']);
    assert.equal(p.looks_like_names, 0);
    assert.equal(p.pct_one_word, 100);
  });

  test('эмодзи считаются', () => {
    const p = core.profileItems(['🍕 Пицца', '☕ Кофе', 'Чай']);
    assert.ok(p.pct_emoji > 0);
    assert.ok(p.pct_emoji < 100);
  });

  test('длины считаются верно', () => {
    const p = core.profileItems(['аб', 'абвгд', 'абвгдеёжз']);
    assert.equal(p.len_min, 2);
    assert.equal(p.len_max, 9);
    assert.equal(p.len_avg, Math.round((2 + 5 + 9) / 3));
  });

  test('пробелы по краям не влияют на длину', () => {
    const p = core.profileItems(['  Костя  ', ' Вася ']);
    assert.equal(p.len_min, 4);
    assert.equal(p.len_max, 5);
  });

  test('смешанный язык даёт обе доли', () => {
    const p = core.profileItems(['Костя', 'Bob', 'Вася', 'Alice']);
    assert.equal(p.pct_cyrillic, 50);
    assert.equal(p.pct_latin, 50);
  });

  test('пустой список даёт null', () => {
    assert.equal(core.profileItems([]), null);
    assert.equal(core.profileItems(null), null);
    assert.equal(core.profileItems(undefined), null);
  });

  test('один вариант обрабатывается без ошибок', () => {
    const p = core.profileItems(['Единственный']);
    assert.equal(p.n, 1);
    assert.equal(p.len_min, p.len_max);
  });

  test('в профиле нет самих строк', () => {
    // Главное свойство: по профилю нельзя восстановить содержимое
    const p = core.profileItems(['Костя', 'Вася']);
    const asText = JSON.stringify(p);
    assert.ok(!asText.includes('Костя'));
    assert.ok(!asText.includes('Вася'));

    // Все значения — числа
    for (const [key, value] of Object.entries(p)) {
      assert.equal(typeof value, 'number', `${key} должно быть числом`);
    }
  });

  test('доли не выходят за 0–100', () => {
    const lists = [
      ['Костя'],
      ['a', 'b', 'c'],
      ['🎉', '🎊'],
      ['Один два три', 'Четыре пять']
    ];
    for (const list of lists) {
      const p = core.profileItems(list);
      for (const key of ['pct_cyrillic', 'pct_latin', 'pct_emoji', 'pct_one_word']) {
        assert.ok(p[key] >= 0 && p[key] <= 100,
          `${key} = ${p[key]} вне диапазона для ${JSON.stringify(list)}`);
      }
    }
  });
});
