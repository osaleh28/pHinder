(function () {
  'use strict';
  const ABG = window.ABG, CASES = window.ABG_CASES;
  const FIELDS = ['sample', 'pH', 'PaCO2', 'HCO3', 'Na', 'Cl', 'K', 'albumin', 'lactate', 'AGrep', 'altitude', 'PaO2', 'o2device', 'o2flow', 'FiO2', 'age', 'Patm', 'SaO2', 'SpO2', 'Hb', 'COHb', 'MetHb', 'usualPaCO2', 'usualHCO3', 'vent', 'setRR', 'totalRR', 'Vt', 'PEEP', 'heightCm', 'sex', 'context', 'osm', 'glucose', 'BUN', 'etoh', 'UNa', 'UK', 'UCl', 'refAG'];
  const ART = { pH: [7.35, 7.45], PaCO2: [35, 45], HCO3: [22, 26] }, VEN = { pH: [7.31, 7.41], PaCO2: [41, 51], HCO3: [23, 27] };
  const RANGES = { pH: [7.35, 7.45], PaCO2: [35, 45], HCO3: [22, 26], Na: [135, 145], Cl: [98, 106], K: [3.5, 5.0], albumin: [3.5, 5.0], lactate: [0, 2], PaO2: [80, 100] };
  const GUESSES = [
    ['metacid', 'Metabolic acidosis'], ['metalk', 'Metabolic alkalosis'],
    ['respacid', 'Respiratory acidosis'], ['respalk', 'Respiratory alkalosis'], ['none', 'No primary disorder']
  ];
  const ROLE = { primary: 'Primary', concomitant: 'Also', hidden: 'Hidden' };

  const $ = function (s) { return document.querySelector(s); };
  const form = $('#abg-form'), results = $('#results');
  const state = { teach: false, caseId: null, guess: null, revealed: false, solved: {} };

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  state.teach = store('abg.teach') === '1';
  try { state.solved = JSON.parse(store('abg.solved') || '{}') || {}; } catch (e) { state.solved = {}; }
  $('#teach').checked = state.teach;

  function f(x, d) { if (x === null || x === undefined || !isFinite(x)) return '—'; const p = Math.pow(10, d === undefined ? 1 : d); return String(Math.round(x * p) / p); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function readForm() { const o = {}; FIELDS.forEach(function (k) { const el = form.elements[k]; o[k] = el.type === 'checkbox' ? el.checked : el.value; }); return o; }
  function fillForm(vals) { FIELDS.forEach(function (k) { const v = vals[k]; if (form.elements[k].type === 'checkbox') { form.elements[k].checked = !!v; return; } form.elements[k].value = v !== undefined && v !== null ? (k === 'pH' && typeof v === 'number' ? v.toFixed(2) : v) : ''; }); }

  function sampleUI(venous) {
    const R = venous ? VEN : ART;
    RANGES.pH = R.pH; RANGES.PaCO2 = R.PaCO2; RANGES.HCO3 = R.HCO3;
    function lbl(id, t) { const el = document.querySelector('label[for="' + id + '"] .lbl'); if (el) el.textContent = t; }
    lbl('PaCO2', venous ? 'PvCO₂' : 'PaCO₂'); lbl('PaO2', venous ? 'PvO₂ (not used)' : 'PaO₂');
    $('#hint-pH').textContent = R.pH.join('–'); $('#hint-PaCO2').textContent = R.PaCO2.join('–') + ' mmHg'; $('#hint-HCO3').textContent = R.HCO3.join('–') + ' mEq/L';
    $('#hint-PaO2').textContent = venous ? 'ignored on a VBG' : '80–100 mmHg';
    $('#gas-legend').textContent = venous ? 'Venous blood gas' : 'Arterial blood gas';
  }

  function flags(vals) {
    document.querySelectorAll('.vent-only').forEach(function (el) { el.hidden = !vals.vent; });
    sampleUI(vals.sample === 'venous');
    Object.keys(RANGES).forEach(function (k) {
      const el = document.querySelector('[data-flag="' + k + '"]'); const n = parseFloat(vals[k]);
      if (!el) return;
      if (vals[k] === '' || !isFinite(n)) { el.textContent = ''; el.className = 'flag'; return; }
      if (n > RANGES[k][1]) { el.textContent = '↑'; el.className = 'flag hi'; el.title = 'Above range'; }
      else if (n < RANGES[k][0]) { el.textContent = '↓'; el.className = 'flag lo'; el.title = 'Below range'; }
      else { el.textContent = ''; el.className = 'flag'; }
      if (el.textContent && ['pH', 'PaCO2', 'HCO3'].indexOf(k) < 0) el.className = 'flag nb';
    });
    // For PaCO2, high is acid-side; for HCO3 low is acid-side. Color by acid/base meaning.
    const c = document.querySelector('[data-flag="PaCO2"]'); if (c.textContent === '↑') c.className = 'flag hi'; else if (c.textContent === '↓') c.className = 'flag lo';
    const h = document.querySelector('[data-flag="HCO3"]'); if (h.textContent === '↑') h.className = 'flag lo'; else if (h.textContent === '↓') h.className = 'flag hi';
    const p = document.querySelector('[data-flag="pH"]'); if (p.textContent === '↑') p.className = 'flag lo'; else if (p.textContent === '↓') p.className = 'flag hi';
  }

  function litmus(pH) {
    const lo = 6.9, hi = 7.9, pct = function (v) { return (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * 100; };
    return '<div class="litmus" aria-hidden="true">' +
      '<div class="bar"></div>' +
      '<div class="band" style="left:' + pct(7.35) + '%;width:' + (pct(7.45) - pct(7.35)) + '%"></div>' +
      '<div class="pin" style="left:' + pct(pH) + '%"><b>' + pH.toFixed(2) + '</b><i></i></div>' +
      '<div class="ticks"><span>6.9</span><span>7.1</span><span>7.3</span><span>7.5</span><span>7.7</span><span>7.9</span></div>' +
      '</div>';
  }

  function figures(r) {
    const d = r.derived, o = r.oxygenation, cells = [];
    function cell(label, val, cls, sub) { cells.push('<div class="fig"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'); }
    let ref = parseFloat(form.elements.refAG.value); if (!isFinite(ref)) ref = 12;
    if (d.cAG !== undefined) cell(r.values.albumin !== null ? 'Anion gap (corr.)' : 'Anion gap', f(d.cAG), d.cAG > ref ? 'acid' : 'ok', r.values.albumin !== null ? 'raw ' + f(d.AG) : 'ref ' + f(ref, 0));
    if (d.expectedPaCO2) cell('Expected PaCO₂', f(d.expectedPaCO2[0], 0) + '–' + f(d.expectedPaCO2[1], 0), '', 'actual ' + f(r.values.PaCO2, 0));
    if (d.expectedHCO3) cell('Expected HCO₃⁻', f(d.expectedHCO3.acute, 0) + ' / ' + f(d.expectedHCO3.chronic, 0), '', 'acute / chronic');
    if (d.deltaGap !== undefined) cell('Delta gap', (d.deltaGap > 0 ? '+' : '') + f(d.deltaGap), d.corrHCO3 > 28 ? 'alk' : d.corrHCO3 < 20 ? 'acid' : (d.corrHCO3 > 26 || d.corrHCO3 < 22) ? 'warn' : 'ok', 'ΔAG − ΔHCO₃⁻');
    if (d.deltaRatio !== undefined) cell('Delta ratio', d.deltaRatio === null ? 'n/a' : f(d.deltaRatio, 2), d.deltaRatio === null || d.deltaRatio > 2 ? 'alk' : d.deltaRatio < 1 ? 'acid' : 'ok', 'corr. HCO₃⁻ ' + f(d.corrHCO3, 0));
    if (d.VE !== undefined) cell('Minute ventilation', f(d.VE), '', 'L/min');
    if (d.VtPBW !== undefined) cell('Tidal volume', f(d.VtPBW), d.VtPBW > 8 ? 'warn' : '', 'mL/kg PBW');
    if (d.CaO2 !== undefined) cell('O₂ content', f(d.CaO2), d.CaO2 < 15 ? 'warn' : 'ok', 'mL/dL · normal 17–20');
    if (d.satGap !== undefined) cell('Saturation gap', f(d.satGap), d.satGap >= 5 ? 'acid' : 'ok', 'SpO₂ − SaO₂ · < 5');
    if (d.osmGap !== undefined) cell('Osmolal gap', f(d.osmGap), d.osmGap > 10 ? 'acid' : 'ok', 'normal < 10');
    if (o) {
      cell('A–a gradient', o.Aa < 0 ? '≈ 0' : f(o.Aa, 0), o.roomAir && o.AaHigh ? 'warn' : '', o.roomAir ? (o.highAlt ? 'at ' + f(o.patm, 0) + ' mmHg' : o.expAa !== null ? 'expected < ' + f(o.expAa, 0) : 'room air') : (r.derived.fio2Estimated ? 'est. FiO₂ ≈ ' : 'on FiO₂ ') + f(o.fio2 * 100, 0) + '%');
      cell('P/F ratio', f(o.PF, 0), o.highAlt ? '' : o.PF <= 300 ? 'warn' : 'ok', o.highAlt ? 'sea-level bands n/a' : o.ards ? o.ards + ' range' : 'normal > 300');
    }
    return cells.length ? '<div class="figures">' + cells.join('') + '</div>' : '';
  }

  function stepHTML(s, i) {
    const tone = s.tone || 'info';
    let h = '<li class="step"><span class="n">' + (i + 1) + '</span>';
    h += '<div class="head"><h4>' + s.title + '</h4><span class="pill t-' + tone + '">' + s.verdict + '</span></div>';
    h += '<p>' + s.detail + '</p>';
    let ex = '';
    if (s.formula && s.formula.length) ex += '<details' + (state.teach ? ' open' : '') + '><summary>' + (state.teach ? 'The math' : 'Show the math') + '</summary><div class="math">' + s.formula.map(esc).join('\n') + '</div></details>';
    if (s.ddx && s.ddx.length) ex += '<details' + (state.teach ? ' open' : '') + '><summary>Differential and next steps</summary><ul class="ddx">' + s.ddx.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
    if (ex) h += '<div class="extras">' + ex + '</div>';
    return h + '</li>';
  }

  function caseBanner(r) {
    const c = CASES.filter(function (x) { return x.id === state.caseId; })[0]; if (!c) return '';
    const correct = r.primaryKeys || [];
    let h = '<div class="panel case-banner"><div class="row"><div class="eyebrow">Practice case</div><button type="button" class="btn" data-act="exit-case">Exit case</button></div>';
    h += '<h2>' + esc(c.title) + '</h2><p>' + esc(c.vignette) + '</p>';
    h += '<div><div class="eyebrow" style="margin-bottom:6px">Your read: what is the primary disorder?</div><div class="guess">';
    GUESSES.forEach(function (g) {
      let cls = '';
      if (state.revealed) { if (correct.indexOf(g[0]) >= 0) cls = 'right'; else if (state.guess === g[0]) cls = 'wrong'; }
      h += '<button type="button" data-guess="' + g[0] + '" aria-pressed="' + (state.guess === g[0]) + '" class="' + cls + '"' + (state.revealed ? ' disabled' : '') + '>' + g[1] + '</button>';
    });
    h += '</div></div>';
    if (state.revealed) {
      const ok = state.guess && correct.indexOf(state.guess) >= 0;
      h += '<div class="verdict-line" style="color:var(--' + (ok ? 'ok' : state.guess ? 'acid' : 'muted') + ')">' + (ok ? 'Correct.' : state.guess ? 'Not quite. The highlighted answer is correct' + (correct.length > 1 ? ' (either is accepted for a mixed picture).' : '.') : 'Answer revealed.') + '</div>';
      h += '<div class="pearl"><strong>Teaching point:</strong> ' + esc(c.teaching) + '</div>';
    } else {
      h += '<div><button type="button" class="btn primary" data-act="reveal">' + (state.guess ? 'Check my answer' : 'Reveal the answer') + '</button></div>';
    }
    return h + '</div>';
  }

  function render() {
    const vals = readForm(); flags(vals);
    const r = ABG.interpret(vals, { refAG: vals.refAG });
    form.elements.FiO2.classList.toggle('need', !!r.needsFiO2);
    FIELDS.forEach(function (k) { const el = form.elements[k]; if (!el) return; const bad = (r.invalid || []).some(function (x) { return x.field === k; }); el.classList.toggle('bad', bad); if (bad) el.setAttribute('aria-invalid', 'true'); else if (!el.classList.contains('need')) el.removeAttribute('aria-invalid'); });
    const dev = vals.o2device, est = (dev && dev !== 'set') ? ABG.estimateFiO2(dev, vals.o2flow) : null;
    const lowFlow = dev === 'nc' || dev === 'mask' || dev === 'nrb';
    $('#flow-field').hidden = !lowFlow;
    form.elements.o2flow.classList.toggle('need', lowFlow && !!r.needsFiO2);
    form.elements.FiO2.placeholder = est && est.fio2 !== null ? String(Math.round(est.fio2)) : '';
    $('#fio2-hint').textContent = vals.FiO2 !== '' ? (dev && dev !== 'set' ? 'entered value overrides device' : 'entered') : est && est.fio2 !== null ? '≈ ' + Math.round(est.fio2) + '% from device' : dev === 'set' ? 'enter the set FiO₂' : 'needed for A–a';
    form.elements.FiO2.setAttribute('aria-invalid', r.needsFiO2 ? 'true' : 'false');
    let html = '';
    if (state.caseId) html += caseBanner(r);

    if (!r.complete) {
      if (r.missing && r.missing.length === 3 && !state.caseId) {
        html += '<div class="panel empty"><div class="eyebrow">Ready</div><h2>Enter a pH, PaCO₂ and HCO₃⁻</h2><p>Add Na⁺, Cl⁻ and albumin for the anion gap and delta ratio, and PaO₂ with FiO₂ for oxygenation. Or load a practice case to see a full worked read.</p></div>';
      } else if (r.missing) {
        html += '<div class="panel empty"><div class="eyebrow">Almost there</div><h2>Still needed: ' + r.missing.map(function (k) { return { pH: 'pH', PaCO2: 'PaCO₂', HCO3: 'HCO₃⁻' }[k]; }).join(', ') + '</h2><p>These three values are the minimum for an acid–base read.</p></div>';
      }
      if (r.warnings.length) html += '<div class="warnings"><strong>Check the highlighted entries</strong>' + r.warnings.map(function (w) { return '<div>' + esc(w) + '</div>'; }).join('') + '</div>';
      results.innerHTML = html; return;
    }

    if (state.caseId && !state.revealed) {
      html += '<div class="panel cover"><h3>Interpretation hidden</h3><p>Work through it yourself: pH, primary process, compensation, anion gap, delta ratio, oxygenation. Choose the primary disorder above, then check your answer.</p></div>';
      results.innerHTML = html; return;
    }

    html += '<div class="panel summary"><div class="eyebrow">Interpretation' + (r.venous ? ' · venous gas, estimated arterial values' : '') + (state.example ? ' · example values: ' + esc(state.example) : '') + '</div><h2>' + esc(r.summary) + '</h2>' + (r.classic ? '<p class="classic">Classic read: <strong>' + esc(r.classic) + '</strong></p>' : '');
    if (r.disorders.length) {
      html += '<div class="chips">' + r.disorders.map(function (d) {
        const t = d.tone === 'acid' ? 't-acid' : 't-alk';
        return '<span class="chip ' + t + '"><span class="role">' + (ROLE[d.role] || 'Also') + '</span>' + (d.qualifier && d.qualifier !== 'acute or chronic' ? d.qualifier.charAt(0).toUpperCase() + d.qualifier.slice(1) + ' ' + d.label.toLowerCase() : d.label) + '</span>';
      }).join('') + '</div>';
    } else {
      html += '<div class="chips"><span class="chip t-normal"><span class="role">Result</span>No acid–base disorder detected</span></div>';
    }
    html += litmus(r.values.pH) + '</div>';
    (r.alerts || []).forEach(function (al) { html += '<div class="alert danger" role="alert"><div><strong>' + esc(al.title) + '</strong><div>' + esc(al.text) + '</div></div></div>'; });
    if (r.osmPrompt) html += '<div class="alert"><div><strong>' + (r.osmPrompt.kind === 'measure' ? 'Unexplained anion gap' : 'Osmolal gap incomplete') + '</strong><div>' + esc(r.osmPrompt.kind === 'measure' ? 'Consider a toxic alcohol: measure serum osmolality and calculate the osmolal gap.' : r.osmPrompt.text) + '</div></div><button type="button" class="btn" data-act="open-osm">Enter osmolal gap values</button></div>';
    if (r.warnings.length) html += '<div class="warnings"><strong>Check before relying on this</strong>' + r.warnings.map(function (w) { return '<div>' + esc(w) + '</div>'; }).join('') + '</div>';
    html += figures(r);
    html += '<div class="panel steps-wrap"><h3>Step by step</h3><ol class="steps">' + r.steps.map(stepHTML).join('') + '</ol></div>';
    results.innerHTML = html;
  }

  // ---------- Practice ----------
  function renderCases() {
    $('#case-grid').innerHTML = CASES.map(function (c) {
      const v = c.values;
      return '<button type="button" class="case-card" data-case="' + c.id + '"><h3>' + esc(c.title) + '</h3><p>' + esc(c.vignette) + '</p>' +
        (state.solved[c.id] ? '<span class="done">✓ Solved</span>' : '') +
        '<div class="gas">' + (v.sample === 'venous' ? 'VBG · pH ' : 'pH ') + v.pH.toFixed(2) + (v.sample === 'venous' ? ' · PvCO₂ ' : ' · PaCO₂ ') + v.PaCO2 + ' · HCO₃⁻ ' + v.HCO3 + '</div></button>';
    }).join('');
  }
  function loadCase(id, hidden, noScroll) {
    const c = CASES.filter(function (x) { return x.id === id; })[0]; if (!c) return;
    fillForm(Object.assign({}, c.values));
    if (c.values.altitude || c.values.usualPaCO2 || c.values.usualHCO3) $('#more').open = true;
    state.caseId = hidden ? id : null; state.guess = null; state.revealed = false;
    state.example = hidden ? null : c.title;
    showView('interpret'); render();
    if (!noScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showView(v) {
    $('#view-interpret').hidden = v !== 'interpret';
    $('#view-practice').hidden = v !== 'practice';
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === v)); });
    if (v === 'practice') renderCases();
  }

  // ---------- Events ----------
  form.addEventListener('input', function () { state.example = null; render(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  $('#btn-clear').addEventListener('click', function () { fillForm({}); state.caseId = null; state.example = null; render(); form.elements.pH.focus(); });
  let exIdx = 0;
  $('#btn-example').addEventListener('click', function () { exIdx = (exIdx + 1) % CASES.length; loadCase(CASES[exIdx].id, false); });
  $('#teach').addEventListener('change', function (e) { state.teach = e.target.checked; store('abg.teach', state.teach ? '1' : '0'); render(); });
  document.querySelectorAll('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showView(b.dataset.view); }); });
  $('#case-grid').addEventListener('click', function (e) { const b = e.target.closest('[data-case]'); if (b) loadCase(b.dataset.case, true); });
  results.addEventListener('click', function (e) {
    const g = e.target.closest('[data-guess]');
    if (g && !state.revealed) { state.guess = state.guess === g.dataset.guess ? null : g.dataset.guess; render(); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'reveal') {
      state.revealed = true;
      const r = ABG.interpret(readForm());
      if (state.guess && r.primaryKeys.indexOf(state.guess) >= 0) { state.solved[state.caseId] = true; store('abg.solved', JSON.stringify(state.solved)); }
      render();
    }
    if (a.dataset.act === 'open-osm') {
      $('#more').open = true;
      const tgt = ['osm', 'Na', 'glucose', 'BUN'].map(function (k) { return form.elements[k]; }).filter(function (el) { return !el.value; })[0] || form.elements.osm;
      tgt.focus(); tgt.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (a.dataset.act === 'exit-case') { state.caseId = null; render(); }
  });

  // Start: a worked example so the page shows what it does; deep link #practice opens the case list
  if (location.hash === '#practice') { showView('practice'); fillForm({}); render(); }
  else { loadCase('ards', false, true); }
})();
