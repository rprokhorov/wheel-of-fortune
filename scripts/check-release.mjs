import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const tag = process.argv[2] || `v${pkg.version}`;
assert.match(tag, /^v\d+\.\d+\.\d+$/, 'Нужен релизный тег vX.Y.Z');
assert.equal(tag, `v${pkg.version}`, 'Тег должен совпадать с package.json');
for (const name of ['package-lock.json', 'collector/package.json', 'collector/package-lock.json']) {
  const data = JSON.parse(read(name));
  assert.equal(data.version, pkg.version, `Версия ${name}`);
  if (data.packages) assert.equal(data.packages[''].version, pkg.version, `Корень ${name}`);
}
assert.ok(read('js/analytics.js').includes(`APP_VERSION = '${pkg.version}'`), 'Версия аналитики');
const notes = read(`docs/releases/${tag}.md`);
assert.match(notes, /## Что изменилось/);
assert.match(notes, /## Проверки/);
assert.match(notes, /## Обновление/);
assert.ok(read('.env.example').includes(`TAG=${tag}\n`), 'Версия в .env.example');
console.log(`Метаданные ${tag} согласованы`);
