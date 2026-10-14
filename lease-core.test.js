// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lease-core.js');

const vals = patch => C.validateInputs(Object.assign(C.blankInputs(), patch)).values;
const FAKE_PARCEL = { label: 'Test parcel', observations: [{ key: 'soil', name: 'Soil', value: 'Loam', status: 'ok', source: 'USDA SSURGO' }] };

test('per-acre and flat annual rent', () => {
  assert.equal(C.calcRent(vals({ rentBasis: 'per_acre', rentAmount: '250', chargedAcres: '40', termYears: '2' })).annualBase, 10000);
  assert.equal(C.calcRent(vals({ rentBasis: 'flat', rentAmount: '12,500', termYears: '2' })).annualBase, 12500);
  assert.equal(C.calcRent(vals({ rentBasis: 'flat', rentAmount: '$12,500', termYears: '2' })).totalScheduled, 25000);
});

test('zero rent is a valid explicit value', () => {
  const r = C.calcRent(vals({ rentBasis: 'per_acre', rentAmount: '0', chargedAcres: '50', termYears: '1' }));
  assert.equal(r.annualBase, 0);
  assert.equal(r.totalScheduled, 0);
  assert.deepEqual(r.missing, []);
});

test('missing rent and acreage are reported, blanks never become zero', () => {
  const v = vals({ rentBasis: 'per_acre', rentAmount: '', chargedAcres: '', termYears: '' });
  assert.equal(v.rentAmount, null);
  assert.equal(v.chargedAcres, null);
  const r = C.calcRent(v);
  assert.equal(r.annualBase, null);
  assert.deepEqual(r.missing, ['rent amount', 'charged acreage', 'lease term']);
  assert.equal(C.screen(v, [], FAKE_PARCEL, []).status, 'hold');
});

test('zero usable acreage gives no per-acre figure instead of dividing by zero', () => {
  const r = C.calcRent(vals({ rentAmount: '100', chargedAcres: '10', usableAcres: '0', termYears: '1' }));
  assert.equal(r.perUsableAcre, null);
  assert.match(r.perUsableNote, /zero/);
});

test('validation rejects negatives, non-positive term and non-finite values', () => {
  const { errors } = C.validateInputs(Object.assign(C.blankInputs(), { rentAmount: '-5', chargedAcres: 'abc', termYears: '0', usableAcres: 'Infinity', escalationPct: '1e999' }));
  assert.ok(errors.rentAmount);
  assert.ok(errors.chargedAcres);
  assert.ok(errors.termYears);
  assert.ok(errors.usableAcres);
  assert.ok(errors.escalationPct);
  assert.equal(C.parseNumber('0x10').error !== null, true);
});

test('annual escalation applies once per anniversary', () => {
  const s = C.rentSchedule(1000, 3, 5);
  assert.deepEqual(s.rows.map(r => r.amount), [1000, 1050, 1102.5]);
  assert.equal(s.total, 3152.5);
});

test('fractional final year is prorated at that year\'s rate', () => {
  const s = C.rentSchedule(1000, 2.5, 10);
  assert.deepEqual(s.rows.map(r => [r.fraction, r.annualRate, r.amount]), [[1, 1000, 1000], [1, 1100, 1100], [0.5, 1210, 605]]);
  assert.equal(s.total, 2705);
});

test('blank escalation is stated, not asserted as none', () => {
  const r = C.calcRent(vals({ rentAmount: '100', chargedAcres: '10', termYears: '2' }));
  assert.equal(r.escalationNote, 'No escalation modeled; escalation terms were not supplied.');
});

test('unknown costs are not treated as zero', () => {
  const v = vals({ rentAmount: '100', chargedAcres: '10', termYears: '1', otherCostsAnnual: '' });
  const r = C.calcRent(v);
  assert.equal(r.otherKnown, null);
  assert.ok(r.unknownCategories.includes('Other annual occupancy costs'));
  const memo = C.buildMemo(C.generate(Object.assign(C.newRecord(), { inputs: Object.assign(C.blankInputs(), { rentAmount: '100', chargedAcres: '10', termYears: '1' }) })));
  const rentTable = memo.sections.find(s => s.id === 'rent').blocks[0].table.rows;
  assert.equal(rentTable.find(r => r[0] === 'Other known annual occupancy costs')[1], 'Unknown');
  assert.ok(rentTable.find(r => r[0] === 'Known-cost subtotal (year 1)'));
});

test('irrigation required with unverified evidence holds, and a plain status change does not clear it', () => {
  const inputs = Object.assign(C.blankInputs(), { rentAmount: '100', chargedAcres: '10', termYears: '1', irrigationRequired: 'yes', waterEvidence: 'reviewed' });
  let rec = C.generate(Object.assign(C.newRecord(), { inputs, parcel: FAKE_PARCEL }));
  assert.equal(rec.screening.status, 'hold');
  assert.ok(rec.screening.reasons.some(r => r.rule === 'R1'));
  // Marking resolved with no basis/reviewer does not clear the hold.
  rec.tasks = rec.tasks.map(t => t.id === 'water-supply-docs' ? C.updateTask(t, { status: 'resolved' }) : t);
  assert.equal(C.screen(C.validateInputs(inputs).values, rec.tasks, FAKE_PARCEL, []).reasons.some(r => r.rule === 'R1'), true);
  // Recording reviewer + basis clears R1.
  rec.tasks = rec.tasks.map(t => ['water-supply-docs', 'water-requirement', 'confirm-acreage'].includes(t.id) ? C.updateTask(t, { reviewer: 'A. Reviewer', resolutionBasis: 'Pump test reviewed', status: 'resolved' }) : t);
  const res = C.screen(C.validateInputs(inputs).values, rec.tasks, FAKE_PARCEL, []);
  assert.equal(res.reasons.some(r => r.rule === 'R1'), false);
});

test('owner statements are not treated as confirmed facts', () => {
  const base = { rentAmount: '100', chargedAcres: '100', termYears: '1', irrigationRequired: 'no', minUsableAcres: '95', usableAcres: '80' };
  const owner = C.screen(vals(Object.assign({}, base, { usableAcresBasis: 'owner_statement' })), [], FAKE_PARCEL, []);
  assert.equal(owner.status, 'hold');
  assert.ok(owner.reasons.some(r => r.rule === 'R4'));
  const map = C.screen(vals(Object.assign({}, base, { usableAcresBasis: 'map_estimate' })), [], FAKE_PARCEL, []);
  assert.equal(map.status, 'hold');
});

test('confirmed conflict with minimum acreage does not meet requirements', () => {
  const v = vals({ rentAmount: '100', chargedAcres: '100', termYears: '1', irrigationRequired: 'no', minUsableAcres: '95', usableAcres: '80', usableAcresBasis: 'user_confirmed' });
  const res = C.screen(v, [], FAKE_PARCEL, []);
  assert.equal(res.status, 'fail');
  assert.equal(res.label, 'Does not meet stated requirements');
});

test('advance only when no rule triggers', () => {
  const v = vals({ rentAmount: '100', chargedAcres: '100', termYears: '1', irrigationRequired: 'no' });
  assert.equal(C.screen(v, [], FAKE_PARCEL, []).status, 'advance');
  assert.equal(C.screen(v, [], null, []).status, 'hold'); // no parcel scan
});

test('task regeneration keeps edits and does not duplicate', () => {
  let rec = C.generate(Object.assign(C.newRecord(), { inputs: Object.assign(C.blankInputs(), { irrigationRequired: 'yes' }) }));
  const count = rec.tasks.length;
  rec.tasks = rec.tasks.map(t => t.id === 'baseline' ? C.updateTask(t, { owner: 'Liza', evidenceNote: 'Photos scheduled' }) : t);
  rec = C.generate(rec);
  rec = C.generate(rec);
  assert.equal(rec.tasks.length, count);
  assert.equal(new Set(rec.tasks.map(t => t.id)).size, rec.tasks.length);
  const b = rec.tasks.find(t => t.id === 'baseline');
  assert.equal(b.owner, 'Liza');
  assert.equal(b.evidenceNote, 'Photos scheduled');
});

test('changed inputs mark reviewed conclusions outdated without deleting history', () => {
  let rec = C.generate(Object.assign(C.newRecord(), { inputs: Object.assign(C.blankInputs(), { irrigationRequired: 'yes', waterSource: 'well' }) }));
  rec.tasks = rec.tasks.map(t => t.id === 'water-supply-docs' ? C.updateTask(t, { reviewer: 'R', resolutionBasis: 'Well log', status: 'resolved' }) : t);
  assert.equal(C.isResolved(rec.tasks.find(t => t.id === 'water-supply-docs')), true);
  rec.inputs.waterSource = 'surface';
  rec = C.generate(rec);
  const t = rec.tasks.find(x => x.id === 'water-supply-docs');
  assert.equal(t.outdated, true);
  assert.equal(C.isResolved(t), false);
  assert.equal(t.history.length, 1);
  assert.equal(t.resolutionBasis, 'Well log');
});

test('tasks the user edited survive when no longer triggered', () => {
  let rec = C.generate(Object.assign(C.newRecord(), { inputs: Object.assign(C.blankInputs(), { irrigationRequired: 'yes' }) }));
  rec.tasks = rec.tasks.map(t => t.id === 'inspect-irrigation' ? C.updateTask(t, { owner: 'Sam' }) : t);
  rec.inputs.irrigationRequired = 'no';
  rec = C.generate(rec);
  const t = rec.tasks.find(x => x.id === 'inspect-irrigation');
  assert.ok(t);
  assert.equal(t.stale, true);
  assert.equal(t.owner, 'Sam');
});

test('HTML-like input is escaped in Markdown export', () => {
  const rec = C.generate(Object.assign(C.newRecord(), { inputs: Object.assign(C.blankInputs(), { propertyName: '<img src=x onerror=alert(1)>', notes: '<script>alert(1)</script> | *bold*' }) }));
  const md = C.toMarkdown(C.buildMemo(rec));
  assert.equal(md.includes('<img'), false);
  assert.equal(md.includes('<script>'), false);
  assert.ok(md.includes('&lt;img'));
  assert.ok(md.includes('\\|'));
});

test('corrupted or odd saved state loads safely', () => {
  assert.match(C.parseStore('{not json').warning, /corrupted/);
  assert.deepEqual(C.parseStore('{not json').store.records, {});
  assert.ok(C.parseStore('[1,2,3]').warning);
  const partial = C.parseStore(JSON.stringify({ records: { a: { id: 'a', inputs: { rentAmount: 5, bogus: 'x' }, tasks: [null, { id: 't', status: 'weird' }] }, b: 'garbage' } }));
  assert.equal(Object.keys(partial.store.records).length, 1);
  const r = partial.store.records.a;
  assert.equal(r.inputs.rentAmount, '5');
  assert.equal(r.inputs.bogus, undefined);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].status, 'open');
  assert.match(partial.warning, /skipped/);
});

test('fictional example produces the expected figures and status', () => {
  const rec = C.demoRecord();
  const memo = C.buildMemo(rec);
  assert.equal(memo.rent.annualBase, 30000);
  assert.equal(memo.rent.totalScheduled, 90000);
  assert.equal(memo.rent.perUsableAcre, 333.33);
  assert.equal(memo.result.label, 'Hold pending evidence');
  assert.ok(memo.header.some(b => b.note === C.DEMO_LABEL));
  assert.equal(rec.parcel, null);
  assert.ok(C.toMarkdown(memo).includes('Fictional example'));
});
