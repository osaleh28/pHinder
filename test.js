// Run with: node test.js
const ABG = require('./js/abg-engine.js');
const CASES = require('./js/abg-cases.js');
let fail = 0;
function check(name, cond, msg) { if (!cond) { fail++; console.log('  FAIL', name, msg); } }

for (const c of CASES) {
  const r = ABG.interpret(c.values);
  const keys = r.disorders.map(d => d.key);
  console.log(`\n[${c.id}] ${r.summary}`);
  console.log('  disorders:', r.disorders.map(d => `${d.key}/${d.role}${d.qualifier ? '/' + d.qualifier : ''}`).join(', '),
    '| AG', r.derived.cAG?.toFixed(1), '| ratio', r.derived.deltaRatio?.toFixed(2), '| warnings', r.warnings.length);
  if (r.oxygenation) console.log(`  A-a ${r.oxygenation.Aa.toFixed(0)} P/F ${r.oxygenation.PF.toFixed(0)}`);
  check(c.id, r.warnings.length === 0, 'unexpected warnings: ' + r.warnings.join('; '));
  const e = c.expect;
  if (e.primary) check(c.id, r.primaryKeys.includes(e.primary), `primary ${r.primaryKeys} != ${e.primary}`);
  if (e.primaryAny) check(c.id, e.primaryAny.every(k => r.primaryKeys.includes(k)), `primaryKeys ${r.primaryKeys} missing ${e.primaryAny}`);
  (e.has || []).forEach(k => check(c.id, keys.includes(k), 'missing ' + k));
  (e.not || []).forEach(k => check(c.id, !keys.includes(k), 'unexpected ' + k));
  if (e.alert) check(c.id, (r.alerts || []).some(a => a.title.includes(e.alert)), 'missing alert ' + e.alert);
  if (e.step) { const st = r.steps.find(s => s.id === e.step[0]); check(c.id, st && st.verdict.includes(e.step[1]), 'step ' + e.step[0] + ' verdict "' + (st && st.verdict) + '" lacks ' + e.step[1]); }
  if (e.qualifier) check(c.id, r.disorders[0].qualifier === e.qualifier, `qualifier ${r.disorders[0].qualifier} != ${e.qualifier}`);
}

// Extra edge cases
const extra = [
  ['normal', { pH: 7.40, PaCO2: 40, HCO3: 24, Na: 140, Cl: 104 }, r => r.summary === 'Normal acid–base status'],
  ['combined acid', { pH: 7.05, PaCO2: 60, HCO3: 16 }, r => r.primaryKeys.length === 2 && r.primaryKeys.includes('respacid')],
  ['inconsistent', { pH: 7.40, PaCO2: 60, HCO3: 15 }, r => r.warnings.length > 0],
  ['chronic resp alk full comp', { pH: 7.42, PaCO2: 28, HCO3: 18.5 }, r => r.primaryKeys[0] === 'respalk' && r.disorders.length === 1],
  ['resp acid + met alk', { pH: 7.40, PaCO2: 60, HCO3: 36.5 }, r => r.disorders.some(d => d.key === 'metalk')],
  ['missing', { pH: 7.4 }, r => r.missing && r.missing.length === 2],
  ['decimal comma', { pH: '7,35', PaCO2: '40', HCO3: '21,5' }, r => r.complete && r.invalid.length === 0],
  ['venous conversion', { sample: 'venous', pH: 7.37, PaCO2: 46, HCO3: 26 }, r => r.values.pH === 7.4 && r.values.PaCO2 === 41 && r.values.HCO3 === 25 && !r.oxygenation],
  ['CO normal PaO2 no coox reminder', { pH: 7.4, PaCO2: 40, HCO3: 24, PaO2: 95, FiO2: 21 }, r => r.steps.find(s => s.id === 'oxygenation').ddx.some(x => /co-oximetry/.test(x))],
  ['MetHb alert', { pH: 7.4, PaCO2: 40, HCO3: 24, PaO2: 95, FiO2: 21, MetHb: 25, SpO2: 85, SaO2: 72 }, r => r.alerts.some(a => /Methemoglobin/.test(a.title))],
  ['kPa entry', { pH: 7.4, PaCO2: 5.3, HCO3: 24 }, r => r.warnings.length > 0],
];
for (const [n, v, pred] of extra) {
  const r = ABG.interpret(v);
  console.log(`\n[${n}] ${r.summary} | warnings: ${r.warnings.join('; ')}`);
  check(n, pred(r), 'predicate failed');
}
console.log(fail ? `\n${fail} failures` : '\nAll checks passed');
process.exit(fail ? 1 : 0);
