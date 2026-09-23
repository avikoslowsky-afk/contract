import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the production learning decision with deterministic extraction helpers.
const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const source = server.slice(server.indexOf('function applyLearningRules('), server.indexOf('\nfunction saveOcrJob('));
const normalize = value => String(value || '').toLowerCase();
const rule = { label: 'Vendor', value: 'Acme', tokens: ['acme'], snippet: 'Acme provides maintenance', contractId: 'one' };
function apply(rules, fields = [], text = 'Acme provides maintenance') {
  return vm.runInNewContext(`${source}; applyLearningRules(fields, text)`, {
    fields, text, listLearningRules: () => rules,
    normalizeMainContractKeys: fields => fields,
    normalizeNameForMatch: normalize, cleanOcrText: text => text,
    canonicalContractKeyLabel: label => label,
    isContractKeyLabel: () => true, isBadKeyFieldValue: () => false,
    textContainsValue: (text, value) => normalize(text).includes(normalize(value)),
    findContractKeyField: (fields, label) => fields.find(f => f.label === label),
    snippetAround: text => text,
    addOrUpgradeField: (fields, label, value, confidence, source, snippet) => {
      const next = { label, value, confidence, source, snippet };
      const existing = fields.find(f => f.label === label);
      if (existing) Object.assign(existing, next); else fields.push(next);
    }
  });
}
assert.equal(apply([rule])[0].value, 'Acme', 'Missing fields receive suggestions');
assert.equal(apply([rule], [{ label: 'Vendor', value: '' }])[0].value, 'Acme');
assert.equal(apply([rule], [{ label: 'Vendor', value: 'Other' }])[0].value, 'Other');
assert.equal(apply([rule], [{ label: 'Vendor', value: '', approved: true }])[0].value, '');
assert.equal(apply([rule], [], 'Unrelated document').length, 0);
assert.equal(apply([{ ...rule, tokens: [] }]).length, 0);
assert.equal(apply([rule, { ...rule }, { ...rule }])[0].confidence, 62);
assert.equal(apply([rule, { ...rule, contractId: 'two' }, { ...rule, contractId: 'three' }])[0].confidence, 88);
assert.equal(apply([{ ...rule, label: 'Fee', value: '$100' }], [], 'Acme provides maintenance for $100').length, 0);
assert.equal(apply([{ ...rule, value: 'Other' }]).length, 0, 'A shared snippet cannot prove an absent value');
assert.equal(apply([{ ...rule, tokens: ['', ' ', null] }]).length, 0);
assert.equal(apply([{ ...rule, tokens: ['acme', 'acme', 'acme', 'missing'] }]).length, 0, 'Repeated tokens do not inflate evidence');
assert.equal(apply([rule], [], 'Acmeology provides maintenance').length, 0, 'No substring vendor matches');
const conflict = { ...rule, value: 'Other', tokens: ['other'] };
assert.equal(apply([rule, conflict], [], 'Acme and Other provide maintenance').length, 0);
assert.equal(apply([conflict, rule], [], 'Acme and Other provide maintenance').length, 0, 'Conflict handling is order-independent');
assert.equal(apply([{ ...rule, label: 'Contract Status', value: 'Active', tokens: ['active'] }], [], 'Active').length, 0, 'Do not transfer status');
console.log('PASS learning: missing/blank fields, preserve existing/approved values, source evidence, empty tokens, independent examples, no fee transfer.');
console.log('PASS safeguards: conflicts, whole-value evidence, unique nonempty tokens, no inherited status.');
