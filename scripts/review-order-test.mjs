import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE contracts (id TEXT, status TEXT, review_status TEXT, created_at TEXT, updated_at TEXT, compact_data TEXT, data TEXT)');
const insert = db.prepare('INSERT INTO contracts VALUES (?, ?, ?, ?, ?, ?, ?)');
for (const [id, createdAt, updatedAt, status] of [
  ['old', '2026-08-01', '2026-09-10', 'Needs Review'],
  ['new', '2026-09-09', '2026-09-09', 'Needs Review'],
  ['approved', '2026-09-10', '2026-09-10', 'Active'],
]) {
  const data = JSON.stringify({ id, createdAt, updatedAt });
  insert.run(id, status, '', createdAt, updatedAt, data, data);
}
const where = server.match(/const reviewContractWhere = `([\s\S]*?)`;/)[1];
const query = server.slice(server.indexOf('function reviewContracts(')).match(/db.prepare\(`([\s\S]*?)`\)/)[1].replace('${reviewContractWhere}', where);
assert.deepEqual(db.prepare(query).all(1, 0).map(r => JSON.parse(r.data).id), ['new']);
assert.deepEqual(db.prepare(query).all(1, 1).map(r => JSON.parse(r.data).id), ['old']);
const comparator = app.match(/function newestReviewFirst\(a, b\) \{[\s\S]*?\n    \}/)[0];
const compare = vm.runInNewContext(`(${comparator})`);
assert.equal([{ id: 'old', createdAt: '2026-08-01', updatedAt: '2026-09-10' }, { id: 'new', createdAt: '2026-09-09' }].sort(compare)[0].id, 'new');
assert.equal(compare({}, {}), 0);
db.close();
console.log('Review ordering passed: newest first, edits do not reorder, pagination, approved exclusion, missing dates.');
