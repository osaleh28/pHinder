/*
 * ABG interpretation engine
 * Pure functions, no DOM. Works in the browser (window.ABG) and in Node (module.exports).
 *
 * Units: pH, PaCO2/PaO2 mmHg, HCO3/Na/Cl/K mEq/L, albumin g/dL,
 *        glucose/BUN/ethanol mg/dL, osmolality mOsm/kg, FiO2 % (or fraction), Patm mmHg.
 *
 * References for the rules used here:
 *  - Winter's formula: expected PaCO2 = 1.5 x HCO3 + 8 +/- 2
 *  - Metabolic alkalosis: expected PaCO2 = 40 + 0.7 x (HCO3 - 24) +/- 2
 *  - Respiratory acidosis: HCO3 rises 1 (acute) / 3.5 (chronic) per 10 mmHg PaCO2 rise
 *  - Respiratory alkalosis: HCO3 falls 2 (acute) / 4 (chronic) per 10 mmHg PaCO2 fall
 *  - Albumin-corrected AG = AG + 2.5 x (4.0 - albumin)
 *  - Delta ratio = (AG - 12) / (24 - HCO3)
 *  - Alveolar gas equation: PAO2 = FiO2 x (Patm - 47) - PaCO2 / 0.8
 */
(function (root) {
  'use strict';

  const NORMAL = { pH: [7.35, 7.45], PaCO2: [35, 45], HCO3: [22, 26] };
  const REF = { pH: 7.4, PaCO2: 40, HCO3: 24, albumin: 4.0 };
  const TOL = 2;
  // Accepted input ranges. Values outside are rejected as entry errors (typo or wrong units).
  const LIMITS = {
    pH: { name: 'pH', min: 6.5, max: 8.0, range: '6.50–8.00', hint: 'That is outside the survivable range and the reportable range of most analyzers.' },
    PaCO2: { name: 'PaCO₂', min: 8, max: 200, unit: 'mmHg' },
    HCO3: { name: 'HCO₃⁻', min: 1, max: 70, unit: 'mEq/L' },
    Na: { name: 'Na⁺', min: 90, max: 200, unit: 'mEq/L' },
    Cl: { name: 'Cl⁻', min: 50, max: 160, unit: 'mEq/L' },
    K: { name: 'K⁺', min: 1, max: 10, unit: 'mEq/L' },
    albumin: { name: 'Albumin', min: 0.5, max: 7, unit: 'g/dL' },
    lactate: { name: 'Lactate', min: 0, max: 30, unit: 'mmol/L' },
    AGrep: { name: 'Reported AG', min: -5, max: 60, unit: 'mEq/L' },
    PaO2: { name: 'PaO₂', min: 15, max: 700, unit: 'mmHg' },
    FiO2: { name: 'FiO₂', min: 21, max: 100, unit: '%' },
    o2flow: { name: 'O₂ flow', min: 0.5, max: 15, unit: 'L/min', hint: 'For high-flow devices, choose "Set FiO₂" and enter the FiO₂.' },
    age: { name: 'Age', min: 0, max: 120, unit: 'years' },
    altitude: { name: 'Altitude', min: -1500, max: 30000, unit: 'ft' },
    Patm: { name: 'Barometric pressure', min: 200, max: 800, unit: 'mmHg' },
    osm: { name: 'Measured osmolality', min: 200, max: 500, unit: 'mOsm/kg' },
    glucose: { name: 'Glucose', min: 10, max: 3000, unit: 'mg/dL' },
    BUN: { name: 'BUN', min: 1, max: 300, unit: 'mg/dL' },
    etoh: { name: 'Ethanol', min: 0, max: 1000, unit: 'mg/dL' },
    UNa: { name: 'Urine Na⁺', min: 0, max: 400, unit: 'mEq/L' },
    UK: { name: 'Urine K⁺', min: 0, max: 400, unit: 'mEq/L' },
    UCl: { name: 'Urine Cl⁻', min: 0, max: 400, unit: 'mEq/L' },
    refAG: { name: 'Reference AG', min: 3, max: 20, unit: 'mEq/L' },
    SaO2: { name: 'SaO₂', min: 30, max: 100, unit: '%' },
    SpO2: { name: 'SpO₂', min: 30, max: 100, unit: '%' },
    COHb: { name: 'COHb', min: 0, max: 80, unit: '%' },
    MetHb: { name: 'MetHb', min: 0, max: 80, unit: '%' },
    Hb: { name: 'Hemoglobin', min: 2, max: 25, unit: 'g/dL' },
    usualPaCO2: { name: 'Usual PaCO₂', min: 25, max: 120, unit: 'mmHg' },
    usualHCO3: { name: 'Usual HCO₃⁻', min: 10, max: 60, unit: 'mEq/L' },
    setRR: { name: 'Set rate', min: 4, max: 60, unit: 'breaths/min' },
    totalRR: { name: 'Total rate', min: 4, max: 70, unit: 'breaths/min' },
    Vt: { name: 'Tidal volume', min: 100, max: 1500, unit: 'mL' },
    PEEP: { name: 'PEEP', min: 0, max: 30, unit: 'cmH₂O' },
    heightCm: { name: 'Height', min: 100, max: 230, unit: 'cm' }
  }; // tolerance (mmHg or mEq/L) around expected compensation

  const LABELS = {
    metacid: 'Metabolic acidosis',
    hagma: 'High anion gap metabolic acidosis',
    hagmaLactic: 'High anion gap (lactic) metabolic acidosis',
    nagma: 'Normal anion gap metabolic acidosis',
    metalk: 'Metabolic alkalosis',
    respacid: 'Respiratory acidosis',
    respalk: 'Respiratory alkalosis'
  };
  const TONE = { metacid: 'acid', hagma: 'acid', nagma: 'acid', respacid: 'acid', metalk: 'alk', respalk: 'alk' };

  // Differential diagnoses shown under "Differential and next steps". Edit these lists to change what the app suggests.
  const DDX = {
    hagma: [
      'Methanol intoxication',
      'Uremia',
      'Diabetic ketoacidosis, alcoholic ketoacidosis, starvation ketoacidosis',
      'Paraldehyde toxicity',
      'Isoniazid',
      'Lactic acidosis: type A (tissue ischemia); type B (altered cellular metabolism)',
      'Ethanol or ethylene glycol intoxication',
      'Salicylate intoxication',
      'Next step: check lactate, ketones (beta-hydroxybutyrate), creatinine/BUN, salicylate level, serum osmolality'
    ],
    nagma: [
      'Normal anion gap acidosis will have an increase in [Cl⁻]',
      'GI loss of HCO₃⁻: diarrhea, ileostomy, proximal colostomy, ureteral diversion',
      'Renal loss of HCO₃⁻: proximal RTA, carbonic anhydrase inhibitor (acetazolamide)',
      'Renal tubular disease: ATN, chronic renal disease, distal RTA, aldosterone inhibitors or absence',
      'NaCl infusion, TPN, NH₄⁺ administration',
      'Next step: urine anion gap separates GI from renal causes'
    ],
    metacid: ['Enter Na and Cl to calculate the anion gap and narrow the differential'],
    metalk: [
      'Hypovolemia with Cl⁻ depletion, GI loss of H⁺: vomiting, gastric suction, villous adenoma, diarrhea with chloride-rich fluid',
      'Hypovolemia with Cl⁻ depletion, renal loss of H⁺: loop and thiazide diuretics, post-hypercapnia (especially after institution of mechanical ventilation)',
      'Hypervolemia, Cl⁻ expansion, renal loss of H⁺: edematous states (heart failure, cirrhosis, nephrotic syndrome), hyperaldosteronism, hypercortisolism, excess ACTH, exogenous steroids, hyperreninemia, severe hypokalemia, renal artery stenosis, bicarbonate administration',
      'Next step: urine Cl⁻ (< 20 suggests Cl⁻ depletion; > 20 suggests Cl⁻ expansion or ongoing diuretic effect)'
    ],
    respacid: [
      'Airway obstruction: upper; lower (COPD, asthma, other obstructive lung disease)',
      'CNS depression',
      'Sleep-disordered breathing (OSA or OHS)',
      'Neuromuscular impairment',
      'Ventilatory restriction',
      'Increased CO₂ production: shivering, rigors, seizures, malignant hyperthermia, hypermetabolism, increased carbohydrate intake',
      'Incorrect mechanical ventilation settings'
    ],
    respalk: [
      'CNS stimulation: fever, pain, fear, anxiety, CVA, cerebral edema, brain trauma, brain tumor, CNS infection',
      'Hypoxemia or hypoxia: lung disease, profound anemia, low FiO₂',
      'Stimulation of chest receptors: pulmonary edema, pleural effusion, pneumonia, pneumothorax, pulmonary embolus',
      'Drugs, hormones: salicylates, catecholamines, medroxyprogesterone, progestins',
      'Pregnancy, liver disease, sepsis, hyperthyroidism',
      'Incorrect mechanical ventilation settings'
    ]
  };

  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    let t = String(v).trim();
    if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.'); // accept a decimal comma (7,35)
    const n = typeof v === 'number' ? v : Number(t);
    return isFinite(n) ? n : null;
  }
  function f(x, d) { if (x === null || x === undefined || !isFinite(x)) return '—'; d = d === undefined ? 1 : d; const p = Math.pow(10, d); return String(Math.round(x * p) / p); }
  function inRange(x, r) { return x >= r[0] && x <= r[1]; }

  function interpret(input, opts) {
    opts = opts || {};
    let refAG = num(opts.refAG); if (refAG === null || refAG < 3 || refAG > 20) refAG = 12;

    const v = {};
    ['pH', 'PaCO2', 'HCO3', 'Na', 'Cl', 'K', 'albumin', 'lactate', 'AGrep', 'altitude', 'PaO2', 'FiO2', 'o2flow', 'SaO2', 'SpO2', 'COHb', 'MetHb', 'Hb', 'usualPaCO2', 'usualHCO3', 'setRR', 'totalRR', 'Vt', 'PEEP', 'heightCm', 'age', 'Patm', 'glucose', 'BUN', 'osm', 'etoh', 'UNa', 'UK', 'UCl']
      .forEach(function (k) { v[k] = num(input[k]); });


    const out = {
      alerts: [],
      steps: [], disorders: [], warnings: [], summary: '', primaryKeys: [],
      derived: {}, oxygenation: null, complete: false, values: v
    };

    // ---------- Input limits: anything outside is rejected and left out of the read ----------
    out.invalid = [];
    if (v.FiO2 !== null && v.FiO2 > 0 && v.FiO2 <= 1) v.FiO2 = v.FiO2 * 100; // accept a fraction (0.4) as 40%
    Object.keys(LIMITS).forEach(function (k) {
      const raw = input[k], lim = LIMITS[k];
      if (raw !== undefined && raw !== null && String(raw).trim() !== '' && v[k] === null) {
        out.invalid.push({ field: k, name: lim.name, msg: lim.name + ': "' + String(raw).trim() + '" is not a number.' });
        return;
      }
      if (v[k] === null) return;
      if (v[k] < lim.min || v[k] > lim.max) {
        let msg = lim.name + ' ' + v[k] + ' is outside the accepted range (' + (lim.range || lim.min + '–' + lim.max) + (lim.unit ? (lim.unit === '%' ? '%' : ' ' + lim.unit) : '') + ') and was not used.';
        if (k === 'PaCO2' && v[k] < lim.min) msg += ' If this is in kPa, multiply by 7.5 (' + f(v[k] * 7.5006) + ' mmHg).';
        if (k === 'PaO2' && v[k] < lim.min) msg += ' If this is in kPa, multiply by 7.5 (' + f(v[k] * 7.5006) + ' mmHg).';
        if (k === 'glucose' && v[k] < lim.min) msg += ' If this is in mmol/L, multiply by 18 (' + f(v[k] * 18, 0) + ' mg/dL).';
        if (k === 'BUN' && v[k] < lim.min) msg += ' If this is urea in mmol/L, multiply by 2.8 (' + f(v[k] * 2.8, 0) + ' mg/dL).';
        if (lim.hint) msg += ' ' + lim.hint;
        out.invalid.push({ field: k, name: lim.name, msg: msg });
        v[k] = null;
      }
    });
    // Likely kPa entry: only when the numbers fit as kPa but not as mmHg (real PaCO2 can be as low as ~10–13 at extreme altitude)
    if (v.PaCO2 !== null && v.pH !== null && v.PaCO2 < 15) {
      const hM = Math.pow(10, 9 - v.pH); let looksKpa;
      if (v.HCO3 !== null) {
        const errMm = Math.abs(24 * v.PaCO2 / v.HCO3 - hM) / hM, errKpa = Math.abs(24 * v.PaCO2 * 7.5006 / v.HCO3 - hM) / hM;
        looksKpa = errMm > 0.1 && errKpa <= 0.1;
      } else looksKpa = v.PaCO2 < 10 && v.pH > 7.2 && v.pH < 7.6;
      if (looksKpa) {
        out.invalid.push({ field: 'PaCO2', name: 'PaCO₂', msg: 'PaCO₂ ' + v.PaCO2 + ' fits the pH and HCO₃⁻ only if it is in kPa: multiply by 7.5 (' + f(v.PaCO2 * 7.5006) + ' mmHg).' });
        v.PaCO2 = null;
      }
    }
    if (out.invalid.length) out.warnings = out.invalid.map(function (x) { return x.msg; });
    out.ventilatedFlag = input.vent === true || input.vent === 'yes' || input.vent === 'on' || input.vent === '1';
    out.venous = input.sample === 'venous';
    if (out.venous && v.pH !== null && v.PaCO2 !== null && v.HCO3 !== null) {
      out.rawVenous = { pH: v.pH, PCO2: v.PaCO2, HCO3: v.HCO3, PO2: v.PaO2 };
      v.pH = Math.round((v.pH + 0.03) * 1000) / 1000;
      v.PaCO2 = v.PaCO2 - 5;
      v.HCO3 = v.HCO3 - 1;
      v.PaO2 = null; // venous PO2 says nothing about oxygenation
    }
    if (v.pH === null || v.PaCO2 === null || v.HCO3 === null) {
      out.missing = ['pH', 'PaCO2', 'HCO3'].filter(function (k) { return v[k] === null; });
      return out;
    }
    if (['pH', 'PaCO2', 'HCO3'].some(function (k) { return out.invalid.some(function (x) { return x.field === k; }); })) return out;

    out.complete = true;
    if (out.rawVenous) {
      const rv = out.rawVenous;
      out.steps.push({
        id: 'venous', title: 'Convert the venous gas', tone: 'info',
        verdict: 'Venous sample: read with estimated arterial values',
        detail: 'Peripheral venous blood is slightly more acidic and higher in CO₂ than arterial blood. The read below uses estimated arterial values: pH ' + v.pH.toFixed(2) + ', PaCO₂ ' + f(v.PaCO2) + ', HCO₃⁻ ' + f(v.HCO3) + '. Venous pH and HCO₃⁻ track arterial values closely; venous PCO₂ is less reliable (the gap varies from about 3 to 8 mmHg). ' +
          (rv.PCO2 <= 45 ? 'A venous PCO₂ of 45 or less makes arterial hypercapnia unlikely.' : 'A venous PCO₂ above 45 cannot confirm arterial hypercapnia; get an arterial gas if ventilation matters.') +
          ' The venous PO₂ says nothing about oxygenation, so oxygenation is not assessed.',
        formula: ['pH(arterial) ≈ pH(venous) + 0.03 = ' + rv.pH.toFixed(2) + ' + 0.03 = ' + v.pH.toFixed(2),
          'PaCO₂ ≈ PvCO₂ − 5 = ' + f(rv.PCO2) + ' − 5 = ' + f(v.PaCO2),
          'HCO₃⁻(arterial) ≈ HCO₃⁻(venous) − 1 = ' + f(rv.HCO3) + ' − 1 = ' + f(v.HCO3),
          'In shock, cardiac arrest or severe hypoperfusion the venous–arterial gap becomes large and unpredictable: draw an arterial gas.']
      });
    }
    const d = out.derived;

    function addDisorder(key, role, extra) {
      const same = out.disorders.filter(function (x) { return x.key === key; })[0];
      if (same) return same;
      if (isMetAcid(key)) {
        const generic = out.disorders.filter(function (x) { return x.key === 'metacid'; })[0];
        // upgrade a generic metabolic acidosis once we know its anion gap type
        if (generic && key !== 'metacid') { generic.key = key; generic.label = LABELS[key]; if (extra) for (const e in extra) generic[e] = extra[e]; return generic; }
        if (key === 'metacid') { const any = out.disorders.filter(function (x) { return isMetAcid(x.key); })[0]; if (any) return any; }
      }
      const o = { key: key, label: LABELS[key], role: role || 'concomitant', tone: TONE[key] };
      if (extra) for (const k in extra) o[k] = extra[k];
      out.disorders.push(o);
      return o;
    }
    function isMetAcid(k) { return k === 'metacid' || k === 'hagma' || k === 'nagma'; }
    function has(key) { return out.disorders.some(function (x) { return x.key === key || (key === 'metacid' && isMetAcid(x.key)); }); }

    // ---------- Step 1: internal consistency (Henderson–Hasselbalch) ----------
    const hMeas = Math.pow(10, 9 - v.pH);
    const hCalc = 24 * v.PaCO2 / v.HCO3;
    const pHcalc = 9 - Math.log10(hCalc);
    const diff = Math.abs(hCalc - hMeas) / hMeas;
    d.hMeas = hMeas; d.hCalc = hCalc; d.pHcalc = pHcalc;
    out.steps.push({
      id: 'consistency', title: 'Check the numbers agree',
      tone: diff <= 0.1 ? 'normal' : 'warn',
      verdict: diff <= 0.1 ? 'Internally consistent' : 'Values do not agree',
      detail: diff <= 0.1
        ? 'The reported pH matches the pH predicted from PaCO₂ and HCO₃⁻ (within 10% of [H⁺]).'
        : 'The pH predicted from PaCO₂ and HCO₃⁻ is ' + pHcalc.toFixed(2) + ', but the reported pH is ' + v.pH.toFixed(2) + '. Recheck for a transcription error, a venous sample, or HCO₃⁻ taken from a chemistry panel drawn at a different time. The interpretation below may be unreliable.',
      formula: [
        'Henderson equation: [H⁺] = 24 × PaCO₂ ÷ HCO₃⁻',
        '= 24 × ' + f(v.PaCO2) + ' ÷ ' + f(v.HCO3) + ' = ' + f(hCalc) + ' nEq/L  (pH ' + pHcalc.toFixed(2) + ')',
        'Measured [H⁺] = 10^(9 − pH) = ' + f(hMeas) + ' nEq/L;  difference ' + f(diff * 100, 0) + '%'
      ]
    });
    if (diff > 0.1) out.warnings.push('pH, PaCO₂ and HCO₃⁻ are not internally consistent (predicted pH ' + pHcalc.toFixed(2) + ').');

    // ---------- Step 2: pH ----------
    const status = v.pH < NORMAL.pH[0] ? 'acidemia' : v.pH > NORMAL.pH[1] ? 'alkalemia' : 'normal';
    d.status = status;
    out.steps.push({
      id: 'ph', title: 'Read the pH',
      tone: status === 'acidemia' ? 'acid' : status === 'alkalemia' ? 'alk' : 'normal',
      verdict: status === 'acidemia' ? 'Acidemia' : status === 'alkalemia' ? 'Alkalemia' : v.pH <= 7.35 ? 'Low-normal pH (7.35)' : v.pH >= 7.45 ? 'High-normal pH (7.45)' : 'Normal pH',
      detail: status === 'normal'
        ? 'pH is within 7.35–7.45. A normal pH does not exclude a disorder: if PaCO₂ or HCO₃⁻ is abnormal, two opposing processes may be cancelling out.'
        : 'pH ' + v.pH.toFixed(2) + ' is ' + (status === 'acidemia' ? 'below 7.35' : 'above 7.45') + '. The primary process must be an ' + (status === 'acidemia' ? 'acidosis' : 'alkalosis') + ', because compensation never overshoots.',
      formula: ['Normal pH 7.35–7.45 (mean 7.40)']
    });

    // ---------- Step 3: primary disorder ----------
    const co2 = v.PaCO2, hco3 = v.HCO3;
    const co2Hi = co2 > NORMAL.PaCO2[1], co2Lo = co2 < NORMAL.PaCO2[0];
    const hco3Lo = hco3 < NORMAL.HCO3[0], hco3Hi = hco3 > NORMAL.HCO3[1];
    let primary = null; // 'metacid' | 'metalk' | 'respacid' | 'respalk' | 'combined-acid' | 'combined-alk' | 'none'
    let primaryDetail = '';

    if (status === 'acidemia') {
      if (co2Hi && hco3Lo) { primary = 'combined-acid'; primaryDetail = 'PaCO₂ is high and HCO₃⁻ is low. Both push the pH down, so this is a combined respiratory and metabolic acidosis. Neither is compensating for the other.'; }
      else if (co2Hi) { primary = 'respacid'; primaryDetail = 'PaCO₂ is above 45 mmHg, which explains the acidemia. The primary process is respiratory.'; }
      else if (hco3Lo) { primary = 'metacid'; primaryDetail = 'HCO₃⁻ is below 22 mEq/L, which explains the acidemia. The primary process is metabolic.'; }
      else {
        const ra = (co2 - 40) / 40, ma = (24 - hco3) / 24;
        primary = ra >= ma ? 'respacid' : 'metacid';
        primaryDetail = 'PaCO₂ and HCO₃⁻ are both inside their reference ranges, so the call rests on which one has moved further in the acid direction (' + (primary === 'respacid' ? 'PaCO₂' : 'HCO₃⁻') + '). Treat this as a mild or early disorder.';
      }
    } else if (status === 'alkalemia') {
      if (co2Lo && hco3Hi) { primary = 'combined-alk'; primaryDetail = 'PaCO₂ is low and HCO₃⁻ is high. Both push the pH up, so this is a combined respiratory and metabolic alkalosis.'; }
      else if (co2Lo) { primary = 'respalk'; primaryDetail = 'PaCO₂ is below 35 mmHg, which explains the alkalemia. The primary process is respiratory.'; }
      else if (hco3Hi) { primary = 'metalk'; primaryDetail = 'HCO₃⁻ is above 26 mEq/L, which explains the alkalemia. The primary process is metabolic.'; }
      else {
        const rl = (40 - co2) / 40, ml = (hco3 - 24) / 24;
        primary = rl >= ml ? 'respalk' : 'metalk';
        primaryDetail = 'PaCO₂ and HCO₃⁻ are both inside their reference ranges, so the call rests on which one has moved further in the alkaline direction (' + (primary === 'respalk' ? 'PaCO₂' : 'HCO₃⁻') + '). Treat this as a mild or early disorder.';
      }
    } else {
      const co2Abn = co2Hi || co2Lo, hco3Abn = hco3Hi || hco3Lo;
      if (!co2Abn && !hco3Abn) { primary = 'none'; primaryDetail = 'pH, PaCO₂ and HCO₃⁻ are all normal. No primary acid–base disorder on the gas alone; the anion gap below can still reveal a hidden one.'; }
      else if (co2Abn && hco3Abn) {
        if (v.pH === 7.4) {
          const respBigger = Math.abs(co2 - 40) / 40 >= Math.abs(hco3 - 24) / 24;
          primary = respBigger ? (co2Hi ? 'respacid' : 'respalk') : (hco3Lo ? 'metacid' : 'metalk');
        } else if (v.pH < 7.4) {
          primary = co2Hi ? 'respacid' : 'metacid';
        } else {
          primary = co2Lo ? 'respalk' : 'metalk';
        }
        if ((co2Hi && hco3Lo) || (co2Lo && hco3Hi)) {
          primaryDetail = 'PaCO₂ and HCO₃⁻ are moving in the same pH direction yet the pH is normal. That combination is not physiologic; check the values.';
          out.warnings.push('PaCO₂ and HCO₃⁻ both push pH the same way, but pH is normal.');
        } else {
          primaryDetail = 'pH is normal but both PaCO₂ and HCO₃⁻ are abnormal. Compensation rarely returns pH fully to normal, so suspect a mixed disorder unless the compensation check below fits. The primary process is taken from the side of 7.40 the pH sits on (' + v.pH.toFixed(2) + ' → ' + LABELS[primary].toLowerCase() + '). Chronic respiratory alkalosis is the one disorder that can fully normalize pH.';
        }
      } else if (co2Abn) {
        primary = co2Hi ? 'respacid' : 'respalk';
        primaryDetail = 'Only PaCO₂ is abnormal. With a normal pH this is a mild ' + LABELS[primary].toLowerCase() + ' with compensation, or a mixed picture; the compensation step decides.';
      } else {
        primary = hco3Lo ? 'metacid' : 'metalk';
        primaryDetail = 'Only HCO₃⁻ is abnormal. With a normal pH this is a mild ' + LABELS[primary].toLowerCase() + ' or a mixed picture; the compensation step decides.';
      }
    }
    d.primary = primary;

    if (primary === 'combined-acid') { addDisorder('respacid', 'primary'); addDisorder('metacid', 'primary'); out.primaryKeys = ['respacid', 'metacid']; }
    else if (primary === 'combined-alk') { addDisorder('respalk', 'primary'); addDisorder('metalk', 'primary'); out.primaryKeys = ['respalk', 'metalk']; }
    else if (primary !== 'none') { addDisorder(primary, 'primary'); out.primaryKeys = [primary]; }
    else out.primaryKeys = ['none'];

    // In normal-pH mixed pictures, either process is an acceptable "primary" answer
    if (status === 'normal' && primary !== 'none' && (co2Hi || co2Lo) && (hco3Hi || hco3Lo)) {
      const other = (primary === 'respacid' || primary === 'respalk') ? (hco3Lo ? 'metacid' : 'metalk') : (co2Hi ? 'respacid' : 'respalk');
      out.primaryKeys.push(other);
    }

    out.steps.push({
      id: 'primary', title: 'Find the primary process',
      tone: primary === 'none' ? 'normal' : (primary.indexOf('acid') >= 0 ? 'acid' : 'alk'),
      verdict: primary === 'none' ? 'No primary disorder on the gas' :
        primary === 'combined-acid' ? 'Combined respiratory + metabolic acidosis' :
        primary === 'combined-alk' ? 'Combined respiratory + metabolic alkalosis' : 'Primary ' + LABELS[primary].toLowerCase(),
      detail: primaryDetail,
      formula: ['PaCO₂ 35–45 mmHg · HCO₃⁻ 22–26 mEq/L', 'Patient: PaCO₂ ' + f(co2) + ' · HCO₃⁻ ' + f(hco3)],
      ddx: primary === 'none' || primary.indexOf('combined') === 0 ? null : (primary === 'metacid' ? null : DDX[primary])
    });

    // ---------- Step 4: compensation ----------
    const BORDER = 1; // within 1 unit outside the ±2 range: within measurement error
    function borderlineResp(isHigh, lo, hi) {
      comp.tone = 'warn'; d.appropriate = true; d.borderline = true;
      comp.verdict = 'Borderline: probably appropriate compensation';
      comp.detail = 'PaCO₂ ' + f(co2) + ' is just ' + (isHigh ? 'above' : 'below') + ' the expected ' + f(lo) + '–' + f(hi) + ' mmHg, by 1 mmHg or less. That is within measurement error, so read this as appropriate compensation. A mild concomitant respiratory ' + (isHigh ? 'acidosis (tiring, sedation)' : 'alkalosis (pain, anxiety, fever, sepsis)') + ' cannot be excluded; if it matters, repeat the gas and look at the clinical picture.';
    }
    const comp = { id: 'compensation', title: 'Check the compensation', formula: [] };
    if (primary === 'metacid') {
      const exp = 1.5 * hco3 + 8, lo = exp - TOL, hi = exp + TOL;
      d.expectedPaCO2 = [lo, hi];
      comp.formula.push("Winter's formula: expected PaCO₂ = 1.5 × HCO₃⁻ + 8 ± 2");
      comp.formula.push('= 1.5 × ' + f(hco3) + ' + 8 = ' + f(exp) + '  →  ' + f(lo) + '–' + f(hi) + ' mmHg');
      comp.formula.push('Shortcut: PaCO₂ ≈ last two digits of pH (7.' + String(Math.round(v.pH * 100)).slice(-2) + ' → ' + String(Math.round(v.pH * 100)).slice(-2) + ')');
      if ((co2 > hi && co2 <= hi + BORDER) || (co2 < lo && co2 >= lo - BORDER)) { borderlineResp(co2 > hi, lo, hi); }
      else if (co2 > hi) { comp.tone = 'acid'; comp.verdict = 'Concomitant respiratory acidosis'; comp.detail = 'PaCO₂ ' + f(co2) + ' is higher than the ' + f(lo) + '–' + f(hi) + ' mmHg expected. Ventilation is not keeping up: consider fatigue, sedation, lung disease, or ventilator settings. A spontaneously breathing patient may be heading for respiratory failure.'; addDisorder('respacid', 'concomitant'); }
      else if (co2 < lo) { comp.tone = 'alk'; comp.verdict = 'Concomitant respiratory alkalosis'; comp.detail = 'PaCO₂ ' + f(co2) + ' is lower than the ' + f(lo) + '–' + f(hi) + ' mmHg expected. Something is driving ventilation beyond compensation: think sepsis, salicylates, liver disease, pain, or hypoxemia.'; addDisorder('respalk', 'concomitant'); }
      else { comp.tone = 'normal'; comp.verdict = 'Appropriate respiratory compensation'; comp.detail = 'PaCO₂ ' + f(co2) + ' falls within the expected ' + f(lo) + '–' + f(hi) + ' mmHg.'; d.appropriate = true; }
      if (lo < 12) comp.formula.push('Note: PaCO₂ rarely falls below 10–12 mmHg, even with maximal compensation.');
    } else if (primary === 'metalk') {
      const expA = 40 + 0.7 * (hco3 - 24), loA = expA - TOL, hiA = expA + TOL;
      d.expectedPaCO2 = [loA, hiA];
      comp.formula.push('Expected PaCO₂ = 40 + 0.7 × (HCO₃⁻ − 24) ± 2');
      comp.formula.push('= 40 + 0.7 × (' + f(hco3) + ' − 24) = ' + f(expA) + '  →  ' + f(loA) + '–' + f(hiA) + ' mmHg');
      comp.formula.push('Compensation seldom pushes PaCO₂ above ~55 mmHg.');
      if ((co2 > hiA && co2 <= hiA + BORDER) || (co2 < loA && co2 >= loA - BORDER)) { borderlineResp(co2 > hiA, loA, hiA); }
      else if (co2 > hiA) { comp.tone = 'acid'; comp.verdict = 'Concomitant respiratory acidosis'; comp.detail = 'PaCO₂ ' + f(co2) + ' is higher than expected (' + f(loA) + '–' + f(hiA) + ' mmHg). A separate cause of hypoventilation is present.'; addDisorder('respacid', 'concomitant'); }
      else if (co2 < loA) { comp.tone = 'alk'; comp.verdict = 'Concomitant respiratory alkalosis'; comp.detail = 'PaCO₂ ' + f(co2) + ' is lower than expected (' + f(loA) + '–' + f(hiA) + ' mmHg). Hypoventilation to compensate is absent, so a respiratory alkalosis is also present.'; addDisorder('respalk', 'concomitant'); }
      else { comp.tone = 'normal'; comp.verdict = 'Appropriate respiratory compensation'; comp.detail = 'PaCO₂ ' + f(co2) + ' falls within the expected ' + f(loA) + '–' + f(hiA) + ' mmHg.'; d.appropriate = true; }
    } else if (primary === 'respacid' && v.usualHCO3 !== null && v.usualPaCO2 !== null && co2 >= v.usualPaCO2 - 2) {
      const riseB = Math.max(0, co2 - v.usualPaCO2), expB = v.usualHCO3 + 0.1 * riseB, loB = expB - TOL, hiB = expB + TOL;
      d.expectedHCO3B = expB; d.baselineUsed = true;
      comp.formula.push('Patient\'s usual values: PaCO₂ ' + f(v.usualPaCO2) + ', HCO₃⁻ ' + f(v.usualHCO3) + ' (chronic compensation already in place)');
      comp.formula.push('Acute rise above usual = ' + f(riseB) + ' mmHg → adds ≈ 0.1 × ' + f(riseB) + ' = ' + f(0.1 * riseB) + ' → expected HCO₃⁻ ≈ ' + f(expB) + ' (' + f(loB) + '–' + f(hiB) + ')');
      const labelB = LABELS[primary].toLowerCase();
      if (hco3 < loB) {
        comp.tone = 'acid'; comp.verdict = 'Concomitant metabolic acidosis';
        comp.detail = 'HCO₃⁻ ' + f(hco3) + ' is below this patient\'s expected ' + f(expB) + ' (usual ' + f(v.usualHCO3) + ' plus the acute CO₂ rise). A new metabolic acidosis has used up bicarbonate, even though ' + f(hco3) + ' might look normal on its own.';
        addDisorder('metacid', 'concomitant');
      } else if (hco3 > hiB) {
        comp.tone = 'alk'; comp.verdict = 'Concomitant metabolic alkalosis';
        comp.detail = 'HCO₃⁻ ' + f(hco3) + ' is above this patient\'s expected ' + f(expB) + '. A metabolic alkalosis (diuretics, vomiting, steroids) is also present.';
        addDisorder('metalk', 'concomitant');
      } else {
        const qB = riseB > 5 ? 'acute-on-chronic' : 'chronic';
        comp.tone = 'normal'; d.appropriate = true; d.chronicity = qB;
        out.disorders[out.disorders.findIndex(function (x) { return x.key === primary; })].qualifier = qB;
        comp.verdict = (qB === 'chronic' ? 'Chronic ' : 'Acute-on-chronic ') + labelB + ' at the patient\'s baseline';
        comp.detail = 'HCO₃⁻ ' + f(hco3) + ' fits this patient\'s usual values plus ' + (riseB > 5 ? 'an acute rise in PaCO₂ of ' + f(riseB) + ' mmHg.' : 'little or no acute change.');
      }
    } else if (primary === 'respacid' || primary === 'respalk') {
      const isAcid = primary === 'respacid';
      const dCO2 = Math.abs(co2 - 40);
      const kA = isAcid ? 0.1 : 0.2, kC = isAcid ? 0.35 : 0.4, sgn = isAcid ? 1 : -1;
      const acute = 24 + sgn * kA * dCO2, chronic = 24 + sgn * kC * dCO2;
      d.expectedHCO3 = { acute: acute, chronic: chronic };
      comp.formula.push(isAcid ? 'Acute: HCO₃⁻ rises 1 per 10 mmHg ↑PaCO₂ · Chronic: rises 3.5 per 10' : 'Acute: HCO₃⁻ falls 2 per 10 mmHg ↓PaCO₂ · Chronic: falls 4 per 10');
      if (isAcid) comp.formula.push('Known CO₂ retainer? Enter the usual PaCO₂ and HCO₃⁻ (under settings) to judge this gas against the patient\'s own baseline.');
      comp.formula.push('ΔPaCO₂ = ' + f(dCO2) + ' mmHg  →  acute HCO₃⁻ ' + f(acute) + ', chronic HCO₃⁻ ' + f(chronic) + ' (± 2)');
      const dpHacute = (isAcid ? -1 : 1) * 0.008 * dCO2, dpHchronic = (isAcid ? -1 : 1) * 0.003 * dCO2;
      comp.formula.push('Expected pH: acute ' + (7.4 + dpHacute).toFixed(2) + ', chronic ' + (7.4 + dpHchronic).toFixed(2) + ' (0.008 vs 0.003 per mmHg)');
      const lowBound = Math.min(acute, chronic) - TOL, highBound = Math.max(acute, chronic) + TOL;
      const nearA = Math.abs(hco3 - acute) <= TOL, nearC = Math.abs(hco3 - chronic) <= TOL;
      const label = LABELS[primary].toLowerCase();
      if (!isAcid && hco3 < 12) {
        comp.tone = 'acid'; comp.verdict = 'Concomitant metabolic acidosis';
        comp.detail = 'HCO₃⁻ ' + f(hco3) + ' is below about 12 mEq/L, the usual floor of renal compensation for respiratory alkalosis, even though the linear formula (' + f(chronic) + ') would allow a little lower. A metabolic acidosis is also present. After prolonged exposure to extreme altitude this may partly reflect maximal renal bicarbonate loss; an anion gap and lactate help separate the two.';
        comp.formula.push('Renal compensation for respiratory alkalosis rarely lowers HCO₃⁻ below about 12–15 mEq/L');
        addDisorder('metacid', 'concomitant');
      } else if ((hco3 < lowBound && hco3 >= lowBound - BORDER) || (hco3 > highBound && hco3 <= highBound + BORDER)) {
        const below = hco3 < lowBound;
        const nearType = isAcid ? (below ? 'acute' : 'chronic') : (below ? 'chronic' : 'acute');
        comp.tone = 'warn'; d.appropriate = true; d.borderline = true; d.chronicity = nearType;
        out.disorders[out.disorders.findIndex(function (x) { return x.key === primary; })].qualifier = nearType;
        comp.verdict = 'Borderline: probably ' + nearType + ' ' + label;
        comp.detail = 'HCO₃⁻ ' + f(hco3) + ' is just ' + (below ? 'below' : 'above') + ' the expected range (' + f(lowBound) + '–' + f(highBound) + '), by less than 1 mEq/L. That is within measurement error, so read this as ' + nearType + ' ' + label + ' with appropriate compensation. A mild concomitant metabolic ' + (below ? 'acidosis' : 'alkalosis') + ' cannot be excluded; repeat the gas or use the clinical picture if it matters.';
      } else if (hco3 < lowBound) {
        comp.tone = 'acid'; comp.verdict = 'Concomitant metabolic acidosis';
        comp.detail = 'HCO₃⁻ ' + f(hco3) + ' is lower than even the ' + (isAcid ? 'acute' : 'chronic') + ' expectation (' + f(Math.min(acute, chronic)) + '). A separate metabolic acidosis is present.';
        addDisorder('metacid', 'concomitant');
      } else if (hco3 > highBound) {
        comp.tone = 'alk'; comp.verdict = 'Concomitant metabolic alkalosis';
        comp.detail = 'HCO₃⁻ ' + f(hco3) + ' is higher than even the ' + (isAcid ? 'chronic' : 'acute') + ' expectation (' + f(Math.max(acute, chronic)) + '). A separate metabolic alkalosis is present.';
        addDisorder('metalk', 'concomitant');
      } else {
        comp.tone = 'normal'; d.appropriate = true;
        let chron;
        if (nearA && nearC) chron = 'acute or chronic';
        else if (nearA) chron = 'acute';
        else if (nearC) chron = 'chronic';
        else chron = isAcid ? 'acute-on-chronic' : 'subacute';
        d.chronicity = chron;
        out.disorders[out.disorders.findIndex(function (x) { return x.key === primary; })].qualifier = chron;
        comp.verdict = chron === 'acute or chronic' ? 'Compensation appropriate (acute vs chronic unclear)' :
          chron === 'acute-on-chronic' ? 'Acute-on-chronic ' + label :
          chron === 'subacute' ? 'Partially compensated (evolving) ' + label :
          chron.charAt(0).toUpperCase() + chron.slice(1) + ' ' + label;
        comp.detail = chron === 'acute or chronic'
          ? 'The PaCO₂ change is small, so acute and chronic expectations overlap. HCO₃⁻ ' + f(hco3) + ' fits either. Use the history.'
          : chron === 'acute-on-chronic'
            ? 'HCO₃⁻ ' + f(hco3) + ' sits between the acute (' + f(acute) + ') and chronic (' + f(chronic) + ') values. Typical of a chronic CO₂ retainer with an acute rise, or an acidosis 1–3 days old.'
            : chron === 'subacute'
              ? 'HCO₃⁻ ' + f(hco3) + ' sits between the acute (' + f(acute) + ') and chronic (' + f(chronic) + ') values: renal compensation is under way but not complete.'
              : 'HCO₃⁻ ' + f(hco3) + ' matches the ' + chron + ' expectation (' + f(chron === 'acute' ? acute : chronic) + ' ± 2). ' + (chron === 'chronic' ? 'Renal compensation takes 3–5 days to develop.' : 'Renal compensation has not had time to develop.');
      }
    } else if (primary === 'combined-acid' || primary === 'combined-alk') {
      comp.tone = primary === 'combined-acid' ? 'acid' : 'alk';
      comp.verdict = 'No compensation to assess';
      comp.detail = 'Both components are primary and push pH the same way, which is why the pH is so far from normal. Both need an explanation.';
      comp.formula.push("For reference, Winter's expected PaCO₂ for this HCO₃⁻: " + f(1.5 * hco3 + 8 - 2) + '–' + f(1.5 * hco3 + 8 + 2) + ' mmHg');
    } else {
      comp.tone = 'normal'; comp.verdict = 'Not applicable';
      comp.detail = 'No primary disorder on the gas, so there is nothing to compensate.';
    }
    // Classic (qualitative) compensation label, as taught in the ROME / nursing method
    if (['metacid', 'metalk', 'respacid', 'respalk'].indexOf(primary) >= 0) {
      const compensating = primary === 'respacid' ? hco3Hi : primary === 'respalk' ? hco3Lo : primary === 'metacid' ? co2Lo : co2Hi;
      const atEdge = v.pH <= 7.35 || v.pH >= 7.45;
      const classic = !compensating ? 'Uncompensated' : status === 'normal' ? (atEdge ? 'Nearly fully compensated' : 'Fully compensated') : 'Partially compensated';
      out.classic = classic + ' ' + LABELS[primary].toLowerCase();
      comp.formula.push('Classic read: ' + out.classic + ' (' + (primary.indexOf('resp') === 0 ? 'HCO₃⁻' : 'PaCO₂') + (compensating ? ' has moved to compensate' : ' is still normal') + (compensating ? (status === 'normal' ? ', pH normal)' : ', pH still abnormal)') : ')'));
      comp.formula.push('The classic label says whether compensation has started. The formulas above say whether it is the right amount; too much or too little means a second disorder.');
    }
    if (diff > 0.1 && comp.verdict && comp.verdict.indexOf('Concomitant') === 0) {
      comp.detail += ' Caution: the pH, PaCO₂ and HCO₃⁻ do not agree with each other (step 1), so this second disorder may be an artifact of the numbers rather than a real finding.';
      comp.tone = 'warn';
    }
    out.steps.push(comp);

    // ---------- Step 5: anion gap ----------
    const agFromLytes = v.Na !== null && v.Cl !== null;
    const agKnown = agFromLytes || v.AGrep !== null;
    let cAG = null;
    if (agKnown) {
      const AG = agFromLytes ? v.Na - (v.Cl + hco3) : v.AGrep;
      cAG = v.albumin !== null ? AG + 2.5 * (REF.albumin - v.albumin) : AG;
      d.AG = AG; d.cAG = cAG;
      const agHigh = cAG > refAG;
      const agName = v.albumin !== null ? 'Corrected AG' : 'AG';
      const agStep = { id: 'ag', title: 'Calculate the anion gap', formula: [] };
      if (agFromLytes) agStep.formula.push('AG = Na⁺ − (Cl⁻ + HCO₃⁻) = ' + f(v.Na) + ' − (' + f(v.Cl) + ' + ' + f(hco3) + ') = ' + f(AG));
      else agStep.formula.push('AG as reported by the lab: ' + f(AG) + ' (enter Na⁺ and Cl⁻ to calculate it here)');
      if (v.albumin !== null) agStep.formula.push('Albumin-corrected AG = AG + 2.5 × (4.0 − albumin) = ' + f(AG) + ' + 2.5 × (4.0 − ' + f(v.albumin) + ') = ' + f(cAG));
      else agStep.formula.push('Enter albumin to correct the AG. Each 1 g/dL drop in albumin lowers the AG by about 2.5.');
      agStep.formula.push('Reference AG: ' + f(refAG) + ' (lab-specific; many modern analyzers run lower, about 8–10)');

      const metAcidPresent = has('metacid');
      if (agHigh) {
        if (metAcidPresent) {
          addDisorder('hagma', null);
          agStep.tone = 'acid'; agStep.verdict = 'Elevated anion gap';
          agStep.detail = (v.albumin !== null && AG <= refAG ? 'The raw AG of ' + f(AG) + ' looks normal, but low albumin hides it; corrected, it is ' + f(cAG) + '. ' : agName + ' ' + f(cAG) + ' is above ' + f(refAG) + '. ') + 'The metabolic acidosis is a high anion gap type: unmeasured acids (lactate, ketones, toxins, uremic anions) are present.';
          agStep.ddx = DDX.hagma;
          if (v.lactate !== null && v.lactate > 2) { agStep.detail += ' Lactate ' + f(v.lactate) + ' mmol/L accounts for at least part of the gap.'; out.disorders.filter(function (x) { return x.key === 'hagma'; })[0].label = LABELS.hagmaLactic; }
        } else if ((primary === 'respalk' || primary === 'respacid') && hco3 < NORMAL.HCO3[0]) {
          // Low HCO3 was attributed to renal compensation, but a gap acid is (at least partly) responsible
          addDisorder('hagma', 'concomitant');
          const pd = out.disorders[0]; delete pd.qualifier; d.appropriate = false; d.chronicity = null;
          comp.tone = 'acid'; comp.verdict = 'Compensation confounded by a gap acidosis';
          comp.detail += ' However, the anion gap is elevated, so part of the fall in HCO₃⁻ comes from a metabolic acidosis rather than renal compensation. Acute versus chronic cannot be judged from HCO₃⁻ here.';
          agStep.tone = 'acid'; agStep.verdict = 'Elevated anion gap: concomitant HAGMA';
          agStep.detail = agName + ' ' + f(cAG) + ' is above ' + f(refAG) + '. The low HCO₃⁻ is not just compensation for the respiratory disorder: a high anion gap metabolic acidosis is also present.';
          agStep.ddx = DDX.hagma;
        } else if (cAG >= refAG + 8) {
          addDisorder('hagma', 'hidden');
          agStep.tone = 'acid'; agStep.verdict = 'Hidden high anion gap metabolic acidosis';
          agStep.detail = agName + ' ' + f(cAG) + ' is well above normal even though HCO₃⁻ is not low. An AG of 20 or more signals a metabolic acidosis whatever the pH or HCO₃⁻. Here a coexisting alkalosis is holding the HCO₃⁻ up.';
          agStep.ddx = DDX.hagma;
        } else {
          agStep.tone = 'warn'; agStep.verdict = 'Mildly elevated anion gap';
          agStep.detail = agName + ' ' + f(cAG) + ' is modestly above ' + f(refAG) + ' without a low HCO₃⁻. Could be an early or hidden HAGMA; alkalemia itself can raise the AG by a few mEq/L. Check lactate and ketones if the picture fits.';
          out.warnings.push('Mildly elevated anion gap without low HCO₃⁻: possible hidden HAGMA.');
        }
      } else {
        if (metAcidPresent) {
          addDisorder('nagma', null);
          agStep.tone = 'acid'; agStep.verdict = 'Normal anion gap';
          agStep.detail = agName + ' ' + f(cAG) + ' is normal, so the metabolic acidosis is hyperchloremic (non-gap): bicarbonate has been lost or chloride gained.';
          agStep.ddx = DDX.nagma.slice();
          if (v.lactate !== null && v.lactate > 2) {
            addDisorder('hagma', 'concomitant', { label: LABELS.hagmaLactic });
            agStep.verdict = 'Normal AG, but lactate is high: HAGMA + NAGMA';
            agStep.detail = agName + ' ' + f(cAG) + ' looks normal, yet lactate is ' + f(v.lactate) + ' mmol/L. Lactate is an unmeasured anion, so a lactic (high anion gap) acidosis is present even though the calculated gap has not risen. ' +
              (v.albumin === null ? 'The most common reason is a low baseline AG from hypoalbuminemia, which is common in critical illness. Enter albumin to check. ' : 'The baseline AG for this patient is probably lower than the reference value. ') +
              'Lactate explains about ' + f(Math.min(v.lactate - 1, 24 - hco3), 0) + ' of the ' + f(24 - hco3, 0) + ' mEq/L fall in HCO₃⁻, so a normal anion gap (hyperchloremic) acidosis accounts for the rest.';
            agStep.formula.push('Lactate ' + f(v.lactate) + ' mmol/L (normal < 2): each mmol/L adds about 1 mEq/L of unmeasured anion');
            agStep.formula.push('HCO₃⁻ deficit = 24 − ' + f(hco3) + ' = ' + f(24 - hco3) + ';  explained by lactate ≈ ' + f(Math.max(0, v.lactate - 1)) + ';  remainder ≈ ' + f(Math.max(0, 24 - hco3 - (v.lactate - 1))) + ' from NAGMA');
            agStep.ddx = DDX.nagma.concat(['Lactic acidosis: type A (shock, hypoperfusion, hypoxia, seizures) or type B (metformin, liver failure, beta-2 agonists or high-dose catecholamines, malignancy, thiamine deficiency)']);
          }
          if (v.K !== null) {
            const knote = v.K < 3.5
              ? 'K⁺ ' + f(v.K) + ' is low. A NAGMA with hypokalemia points to diarrhea or GI loss, distal (type 1) RTA, proximal (type 2) RTA, or carbonic anhydrase inhibitors. Acidosis shifts K⁺ out of cells, so total-body potassium is even lower than the serum level suggests.'
              : v.K > 5.0
                ? 'K⁺ ' + f(v.K) + ' is high. A NAGMA with hyperkalemia points to hypoaldosteronism (type 4 RTA), adrenal insufficiency, early renal failure, or drugs (ACE inhibitors, ARBs, spironolactone, trimethoprim).'
                : 'K⁺ ' + f(v.K) + ' is normal, which does not separate the NAGMA causes well.';
            agStep.ddx.unshift(knote);
          }
        } else {
          agStep.tone = 'normal'; agStep.verdict = 'Normal anion gap';
          agStep.detail = agName + ' ' + f(cAG) + ' is normal. No evidence of a hidden gap acidosis.';
        }
      }
      if (cAG < refAG - 4 && cAG >= 4) {
        agStep.formula.push('AG ' + f(cAG) + ' is low-normal. ' + (v.albumin === null ? 'Low albumin is the usual cause; a low baseline AG can hide a gap acidosis.' : 'A low baseline AG can hide a gap acidosis; compare with the patient\'s previous values.'));
      }
      if (cAG < 4) out.warnings.push('Very low anion gap (' + f(cAG) + '): consider lab error, hypoalbuminemia, paraproteinemia (IgG myeloma), lithium or bromide.');
      out.steps.push(agStep);
    } else {
      out.steps.push({
        id: 'ag', title: 'Calculate the anion gap', tone: 'info', verdict: 'Needs Na⁺ and Cl⁻',
        detail: has('metacid') ? 'A metabolic acidosis is present. Enter Na⁺ and Cl⁻ (and albumin) to tell a high-gap from a normal-gap acidosis.' : 'Enter Na⁺ and Cl⁻ to screen for a hidden high anion gap acidosis. A gap of 20 or more means a metabolic acidosis is present regardless of the pH.',
        formula: ['AG = Na⁺ − (Cl⁻ + HCO₃⁻)'],
        ddx: has('metacid') ? DDX.metacid : null
      });
    }

    // ---------- Step 6: delta-delta ----------
    if (agKnown && cAG > refAG && has('hagma')) {
      const baseHCO3 = v.usualHCO3 !== null ? (d.expectedHCO3B !== undefined ? d.expectedHCO3B : v.usualHCO3) : 24;
      const dAG = cAG - refAG, dHCO3 = baseHCO3 - hco3, corrHCO3 = hco3 + dAG; d.baseHCO3 = baseHCO3;
      d.dAG = dAG; d.dHCO3 = dHCO3; d.corrHCO3 = corrHCO3;
      const ddStep = { id: 'delta', title: 'Look for a second metabolic process', formula: [] };
      ddStep.formula.push('ΔAG = ' + f(cAG) + ' − ' + f(refAG) + ' = ' + f(dAG) + ';  ΔHCO₃⁻ = ' + f(baseHCO3) + ' − ' + f(hco3) + ' = ' + f(dHCO3) + (baseHCO3 !== 24 ? '  (from the patient\'s baseline HCO₃⁻, not 24)' : ''));
      const respNote = has('respacid') && d.chronicity !== 'acute' && !d.baselineUsed && v.usualHCO3 === null ? ' A chronic respiratory acidosis raises baseline HCO₃⁻ and can mimic this.' : '';
      if ((primary === 'respacid' || primary === 'respalk') && !d.baselineUsed) ddStep.formula.push('Caution: the primary respiratory disorder has already shifted HCO₃⁻ through compensation, so the delta ratio is less reliable here.');
      if (dHCO3 <= 0.5) {
        d.deltaRatio = null;
        d.deltaGap = dAG - dHCO3;
        ddStep.formula.push('Delta gap = ΔAG − ΔHCO₃⁻ = ' + f(dAG) + ' − ' + f(dHCO3) + ' = +' + f(dAG - dHCO3) + ';  delta ratio undefined (HCO₃⁻ not below ' + f(baseHCO3) + ')');
        ddStep.formula.push('Corrected HCO₃⁻ = HCO₃⁻ + ΔAG = ' + f(hco3) + ' + ' + f(dAG) + ' = ' + f(corrHCO3));
        ddStep.tone = 'alk'; ddStep.verdict = 'Concomitant metabolic alkalosis';
        ddStep.detail = 'The gap has risen by ' + f(dAG) + ' but HCO₃⁻ has not fallen. Without the gap acid, HCO₃⁻ would be about ' + f(corrHCO3) + ', so a metabolic alkalosis is also present.' + respNote;
        addDisorder('metalk', 'concomitant');
      } else {
        const ratio = dAG / dHCO3; d.deltaRatio = ratio;
        const dGap = dAG - dHCO3; d.deltaGap = dGap;
        ddStep.formula.push('Delta gap = ΔAG − ΔHCO₃⁻ = ' + f(dAG) + ' − ' + f(dHCO3) + ' = ' + (dGap > 0 ? '+' : '') + f(dGap) + '  (−2 to +2 expected if the HAGMA is alone)');
        ddStep.formula.push('Delta ratio = ΔAG ÷ ΔHCO₃⁻ = ' + f(dAG) + ' ÷ ' + f(dHCO3) + ' = ' + f(ratio, 2) + '  (1–2 expected)');
        ddStep.formula.push('Corrected HCO₃⁻ = HCO₃⁻ + ΔAG = ' + f(hco3) + ' + ' + f(dAG) + ' = ' + f(corrHCO3) + '  (' + f(baseHCO3 - 2) + '–' + f(baseHCO3 + 2) + ' if the HAGMA is alone; 1–2 beyond that is borderline)');
        ddStep.formula.push('Corrected HCO₃⁻ > ' + f(baseHCO3 + 4) + ' (delta gap > +4) or ratio > 2: plus metabolic alkalosis · Corrected HCO₃⁻ < ' + f(baseHCO3 - 4) + ' (delta gap < −4) or ratio < 1: plus NAGMA');
        const alkByRatio = ratio > 2, alkByGap = corrHCO3 > baseHCO3 + 4, nagByRatio = ratio < 1, nagByGap = corrHCO3 < baseHCO3 - 4;
        const borderAlk = !alkByGap && corrHCO3 > baseHCO3 + 2, borderNag = !nagByGap && corrHCO3 < baseHCO3 - 2;
        if (alkByRatio || alkByGap) {
          ddStep.tone = 'alk'; ddStep.verdict = 'Concomitant metabolic alkalosis';
          ddStep.detail = 'The gap rose by ' + f(dAG) + ' but HCO₃⁻ fell by only ' + f(dHCO3) + ' (delta gap ' + (dGap > 0 ? '+' : '') + f(dGap) + ', ratio ' + f(ratio, 2) + '). Without the gap acid, HCO₃⁻ would be about ' + f(corrHCO3) + ', above normal, so a metabolic alkalosis (e.g. vomiting, NG suction, diuretics) is holding it up.' +
            (alkByGap && !alkByRatio ? ' The ratio alone (' + f(ratio, 2) + ') falls in the 1–2 band, and lactic acidosis can push it toward 1.6–1.8, so confirm with the history: vomiting or diuretic use makes the alkalosis certain.' : '') + respNote;
          addDisorder('metalk', 'concomitant');
        } else if (nagByRatio || nagByGap) {
          ddStep.tone = 'acid'; ddStep.verdict = 'Concomitant normal anion gap acidosis';
          ddStep.detail = 'HCO₃⁻ fell by ' + f(dHCO3) + ', more than the gap rose (' + f(dAG) + '; delta gap ' + f(dGap) + ', ratio ' + f(ratio, 2) + '). Without the gap acid, HCO₃⁻ would be only about ' + f(corrHCO3) + ', so a non-gap acidosis is also present, e.g. diarrhea, RTA, or saline resuscitation. DKA during treatment often looks like this as ketones are excreted.';
          addDisorder('nagma', 'concomitant');
        } else {
          ddStep.tone = 'normal'; ddStep.verdict = 'Pure high anion gap acidosis';
          ddStep.detail = 'The rise in the gap (' + f(dAG) + ') roughly matches the fall in HCO₃⁻ (' + f(dHCO3) + '): delta gap ' + (dGap > 0 ? '+' : '') + f(dGap) + ', ratio ' + f(ratio, 2) + ', corrected HCO₃⁻ ' + f(corrHCO3) + '. The gap acid accounts for the acidosis on its own. Lactic acidosis typically runs a ratio of about 1.6; ketoacidosis nearer 1.';
          if (borderAlk || borderNag) {
            ddStep.tone = 'warn'; ddStep.verdict = 'Probably pure; borderline for a ' + (borderAlk ? 'metabolic alkalosis' : 'normal gap acidosis');
            ddStep.detail += ' The corrected HCO₃⁻ of ' + f(corrHCO3) + ' is just ' + (borderAlk ? 'above 26' : 'below 22') + ', within the error of the calculation. A mild ' + (borderAlk ? 'metabolic alkalosis (vomiting, diuretics)' : 'normal gap acidosis (diarrhea, saline)') + ' is possible; let the history decide.';
          }
        }
      }
      out.steps.push(ddStep);
    }

    // ---------- Step 7: targeted follow-up tests ----------
    const fu = [];
    const osmKnown = v.osm !== null && v.Na !== null && v.glucose !== null && v.BUN !== null;
    // Prompt to screen for toxic alcohols when a gap acidosis is not explained
    if (has('hagma') && !osmKnown) {
      const gapRise = (cAG !== null && cAG > refAG) ? cAG - refAG : 0;
      const lactExplains = v.lactate !== null ? Math.max(0, v.lactate - 1) : null;
      const unexplained = lactExplains === null ? gapRise : gapRise - lactExplains;
      const needPrompt = gapRise > 0 && (lactExplains === null || unexplained >= 4);
      if (v.osm !== null) {
        const miss = [v.Na === null ? 'Na⁺' : null, v.glucose === null ? 'glucose' : null, v.BUN === null ? 'BUN' : null].filter(Boolean);
        out.osmPrompt = { kind: 'missing', text: 'Measured osmolality entered. Add ' + miss.join(', ') + ' to calculate the osmolal gap.' };
        fu.push({ id: 'toxscreen', title: 'Screen for toxic alcohols', tone: 'warn', verdict: 'Needs ' + miss.join(', '),
          detail: out.osmPrompt.text + ' Glucose and BUN are in mg/dL.',
          formula: ['Calculated Osm = 2 × Na⁺ + glucose ÷ 18 + BUN ÷ 2.8 (+ ethanol ÷ 3.7)', 'Osmolal gap = measured − calculated (normal < 10)'] });
      } else if (needPrompt) {
        const why = lactExplains === null
          ? 'The anion gap is up by ' + f(gapRise, 0) + ' and nothing entered explains it yet. Check lactate, ketones, creatinine and a salicylate level; if they do not account for the gap, a toxic alcohol is possible.'
          : 'The anion gap is up by ' + f(gapRise, 0) + ', but lactate ' + f(v.lactate) + ' explains only about ' + f(lactExplains, 0) + ' of it, leaving about ' + f(unexplained, 0) + ' unexplained. Unless ketones, uremia or salicylates account for the rest, consider a toxic alcohol.';
        out.osmPrompt = { kind: 'measure', text: 'Unexplained anion gap. Consider a toxic alcohol: measure serum osmolality and calculate the osmolal gap.' };
        fu.push({ id: 'toxscreen', title: 'Screen for toxic alcohols', tone: 'warn', verdict: 'Measure serum osmolality',
          detail: why + ' A measured serum osmolality with Na⁺, glucose, BUN and an ethanol level allows the osmolal gap to be calculated. Note that the osmolal gap can be normal late in a toxic alcohol ingestion, and specific methanol and ethylene glycol levels are not available everywhere.',
          formula: ['Calculated Osm = 2 × Na⁺ + glucose ÷ 18 + BUN ÷ 2.8 (+ ethanol ÷ 3.7)', 'Osmolal gap = measured − calculated (normal < 10)',
            'Timing: the parent alcohol raises the osmolal gap early; its toxic acids raise the anion gap later. A late presentation can have a normal osmolal gap.'],
          ddx: ['Clues to a toxic alcohol: intoxicated with a low or negative ethanol level, visual symptoms or optic disc hyperemia (methanol), calcium oxalate crystals or unexplained AKI (ethylene glycol), known access to antifreeze, windshield fluid or moonshine',
            'Propylene glycol: high-dose IV lorazepam or phenobarbital infusions',
            'Isopropanol raises the osmolal gap and causes ketosis without an acidosis'] });
      }
    }
    if (osmKnown) {
      const calcOsm = 2 * v.Na + v.glucose / 18 + v.BUN / 2.8 + (v.etoh !== null ? v.etoh / 3.7 : 0);
      const og = v.osm - calcOsm; d.calcOsm = calcOsm; d.osmGap = og;
      fu.push({
        id: 'osm', title: 'Osmolal gap', tone: og > 10 ? 'acid' : 'normal',
        verdict: og > 10 ? 'Elevated osmolal gap (' + f(og) + ')' : 'Normal osmolal gap (' + f(og) + ')',
        detail: og > 10
          ? 'An osmolal gap above 10 means unmeasured osmoles. With a HAGMA, this raises concern for methanol or ethylene glycol. Other causes: propylene glycol, isopropanol (gap without acidosis), mannitol, severe ketoacidosis or lactic acidosis.'
          : 'No excess unmeasured osmoles. A normal gap does not fully exclude a toxic alcohol late in the course, once it has been metabolized to its acids.',
        formula: ['Calculated Osm = 2 × Na⁺ + glucose ÷ 18 + BUN ÷ 2.8' + (v.etoh !== null ? ' + ethanol ÷ 3.7' : ''),
          '= 2 × ' + f(v.Na) + ' + ' + f(v.glucose) + ' ÷ 18 + ' + f(v.BUN) + ' ÷ 2.8' + (v.etoh !== null ? ' + ' + f(v.etoh) + ' ÷ 3.7' : '') + ' = ' + f(calcOsm),
          'Osmolal gap = measured − calculated = ' + f(v.osm) + ' − ' + f(calcOsm) + ' = ' + f(og) + '  (normal < 10)']
      });
    }
    const uagKnown = v.UNa !== null && v.UK !== null && v.UCl !== null;
    if (uagKnown && has('nagma')) {
      const uag = v.UNa + v.UK - v.UCl; d.UAG = uag;
      fu.push({
        id: 'uag', title: 'Urine anion gap', tone: 'info',
        verdict: uag < 0 ? 'Negative UAG (' + f(uag) + '): extrarenal cause' : 'Positive UAG (+' + f(uag) + '): renal cause',
        detail: uag < 0
          ? 'A negative urine anion gap means the kidney is excreting ammonium (NH₄⁺) appropriately, so the bicarbonate loss is extrarenal: diarrhea or other GI loss.'
          : 'A positive urine anion gap means the kidney is failing to excrete acid (low NH₄⁺): distal (type 1) RTA or hypoaldosteronism (type 4 RTA). Check serum K⁺ and urine pH. Proximal RTA can go either way.',
        formula: ['UAG = urine Na⁺ + urine K⁺ − urine Cl⁻ = ' + f(v.UNa) + ' + ' + f(v.UK) + ' − ' + f(v.UCl) + ' = ' + f(uag),
          'Unreliable if urine Na⁺ < 20 (volume depletion) or with ketonuria or other unmeasured urine anions']
      });
    }
    if (v.UCl !== null && has('metalk')) {
      const resp = v.UCl < 20; d.urineClResponsive = resp;
      fu.push({
        id: 'ucl', title: 'Urine chloride', tone: 'info',
        verdict: resp ? 'Urine Cl⁻ ' + f(v.UCl) + ': chloride-responsive' : 'Urine Cl⁻ ' + f(v.UCl) + ': chloride-resistant',
        detail: resp
          ? 'Urine Cl⁻ below 20 mEq/L means the kidney is avidly holding chloride: volume and chloride depletion from vomiting, NG suction or remote diuretics. This pattern typically corrects as volume and chloride are restored.'
          : 'Urine Cl⁻ above 20 mEq/L points to current diuretic use, mineralocorticoid excess (check blood pressure, renin, aldosterone), Bartter or Gitelman syndrome, or severe hypokalemia.',
        formula: ['Urine Cl⁻ < 20 mEq/L: responsive · > 20 mEq/L: resistant']
      });
    }
    fu.forEach(function (s) { out.steps.push(s); });

    // ---------- Step 8: oxygenation ----------
    let fio2Est = null;
    if (v.FiO2 === null && input.o2device) {
      fio2Est = estimateFiO2(input.o2device, v.o2flow);
      if (fio2Est && fio2Est.fio2 !== null) { v.FiO2 = fio2Est.fio2; d.fio2Estimated = fio2Est; }
    }
    if (v.PaO2 !== null && v.FiO2 === null) {
      out.needsFiO2 = true;
      const lowO2 = v.PaO2 < 80;
      out.steps.push({
        id: 'oxygenation', title: 'Assess oxygenation', tone: 'info',
        verdict: 'Needs FiO₂',
        detail: (fio2Est && fio2Est.warn ? fio2Est.warn + ' ' : '') + 'PaO₂ is ' + f(v.PaO2, 0) + ' mmHg' + (lowO2 ? ', which is below 80.' : '.') + ' Choose the oxygen device and flow, or enter the FiO₂ the sample was drawn on to calculate the A–a gradient and P/F ratio. Use 21% only if the patient was on room air; nasal cannula or mask oxygen raises the FiO₂ and changes the interpretation.',
        formula: ['PAO₂ = FiO₂ × (Patm − 47) − PaCO₂ ÷ 0.8', 'A–a gradient = PAO₂ − PaO₂', 'P/F = PaO₂ ÷ FiO₂'],
        ddx: ['Approximate FiO₂ on nasal cannula: about 20% + 4% per L/min (1 L ≈ 24%, 2 L ≈ 28%, 4 L ≈ 36%, 6 L ≈ 44%). Masks and high-flow devices vary; use the set FiO₂ where there is one.']
      });
    } else if (v.PaO2 !== null) {
      const fio2 = v.FiO2 > 1 ? v.FiO2 / 100 : v.FiO2;
      const patmFromAlt = v.Patm === null && v.altitude !== null && v.altitude > 0;
      const patm = v.Patm !== null ? v.Patm : patmFromAlt ? 760 * Math.pow(1 - 6.8754e-6 * v.altitude, 5.2559) : 760;
      const highAlt = patm < 700;
      const PAO2 = fio2 * (patm - 47) - co2 / 0.8;
      const Aa = PAO2 - v.PaO2;
      const age = v.age;
      const expAa = age !== null ? age / 4 + 4 : null;
      const expPaO2 = age !== null && !highAlt ? 104.2 - 0.27 * age : null;
      const PF = v.PaO2 / fio2;
      const roomAir = Math.abs(fio2 - 0.21) < 0.011;
      const hypox = v.PaO2 < 60 ? (v.PaO2 < 40 ? 'severe' : 'moderate') : v.PaO2 < 80 ? 'mild' : null;
      let AaHigh = expAa !== null ? Aa > expAa + 5 : Aa > 20;
      const extremeAltAa = roomAir && patm < 400 && !AaHigh && Aa > 3;
      if (extremeAltAa) AaHigh = true;
      const ards = PF <= 100 ? 'severe' : PF <= 200 ? 'moderate' : PF <= 300 ? 'mild' : null;
      out.oxygenation = { highAlt: highAlt, fio2: fio2, patm: patm, PAO2: PAO2, Aa: Aa, expAa: expAa, expPaO2: expPaO2, PF: PF, hypox: hypox, AaHigh: AaHigh, ards: ards, roomAir: roomAir };

      const oxDetail = [];
      if (roomAir) {
        if (highAlt) oxDetail.push('At a barometric pressure of ' + f(patm, 0) + ' mmHg' + (patmFromAlt ? ' (about ' + f(v.altitude, 0) + ' ft)' : '') + ', inspired PO₂ is only ' + f(fio2 * (patm - 47), 0) + ' mmHg (sea level: 150), so a low PaO₂ is expected and sea-level norms for PaO₂ do not apply.');
        if (hypox) oxDetail.push((hypox.charAt(0).toUpperCase() + hypox.slice(1)) + ' hypoxemia on room air (PaO₂ ' + f(v.PaO2, 0) + (expPaO2 !== null ? '; expected about ' + f(expPaO2, 0) + ' for age' : '') + ').');
        else oxDetail.push('PaO₂ ' + f(v.PaO2, 0) + ' mmHg on room air is not hypoxemic' + (expPaO2 !== null ? ' (expected about ' + f(expPaO2, 0) + ' for age)' : '') + '.');
        if (extremeAltAa) oxDetail.push('The A–a gradient of ' + f(Aa, 0) + ' would be normal at sea level, but at extreme altitude (barometric pressure ' + f(patm, 0) + ' mmHg) the gradient is normally only a few mmHg, because so little oxygen is available to lose. A gradient of ' + f(Aa, 0) + ' is therefore increased, consistent with diffusion limitation or subclinical high-altitude pulmonary edema, as described in climbers near the summit of Everest.');
        else if (AaHigh) oxDetail.push('The A–a gradient of ' + f(Aa, 0) + ' is widened' + (expAa !== null ? ' (expected < ' + f(expAa, 0) + ' for age)' : '') + ', so the lung itself is not transferring oxygen normally: V/Q mismatch, shunt, or diffusion limitation.');
        else if (hypox) oxDetail.push('The A–a gradient of ' + (Aa < 0 ? 'about 0' : f(Aa, 0)) + ' is normal, so the lungs are transferring oxygen normally. The hypoxemia is explained by ' + (co2 > 45 ? 'hypoventilation (PaCO₂ ' + f(co2, 0) + ' is high).' : (highAlt ? 'the low inspired oxygen at altitude. The low PaCO₂ is the hypoxic ventilatory drive, which raises alveolar PO₂.' : 'low inspired oxygen. PaCO₂ is not high, so hypoventilation is not the cause; check the FiO₂ and barometric pressure.')));
        else oxDetail.push('The A–a gradient of ' + (Aa < 0 ? 'about 0' : f(Aa, 0)) + ' is normal.');
        if (Aa < -10) out.warnings.push('Calculated A–a gradient is ' + f(Aa, 0) + ' mmHg, which is not possible. Check FiO₂, barometric pressure (altitude), and PaO₂.');
        if (!highAlt && hypox && !AaHigh && co2 <= 45) out.warnings.push('Hypoxemia with a normal A–a gradient and no hypercapnia usually means low inspired oxygen. If the patient is at altitude, enter the altitude or barometric pressure under settings.');
      } else {
        oxDetail.push('On FiO₂ ' + f(fio2 * 100, 0) + '%, the P/F ratio of ' + f(PF, 0) + (ards ? ' meets the ' + ards + ' band of the Berlin ARDS criteria (P/F ' + (ards === 'severe' ? '≤ 100' : ards === 'moderate' ? '101–200' : '201–300') + '). ' + (out.ventilatedFlag && v.PEEP !== null ? (v.PEEP >= 5 ? 'PEEP is ' + f(v.PEEP, 0) + ', so the Berlin PEEP ≥ 5 requirement is met. ' : 'PEEP is ' + f(v.PEEP, 0) + ', below the Berlin requirement of 5, so the grade does not strictly apply. ') : out.ventilatedFlag ? 'Enter the PEEP to check the Berlin PEEP ≥ 5 requirement. ' : 'Berlin grading requires ventilation with PEEP or CPAP ≥ 5 (the 2023 global definition also accepts high-flow oxygen ≥ 30 L/min). ') + 'ARDS also requires bilateral opacities, onset within 1 week, and edema not fully explained by heart failure.' : ' is above 300: oxygen transfer is adequate for the support given.'));
        oxDetail.push('A–a gradient ' + f(Aa, 0) + ' mmHg. The normal A–a gradient rises with FiO₂ (up to ~100+ on 100%), so age-based norms only apply on room air.');
      }
      if (d.fio2Estimated && input.o2device !== 'ra') {
        oxDetail.unshift(d.fio2Estimated.note + ' Low-flow devices deliver a variable FiO₂ that falls as the patient breathes faster or deeper, so treat the A–a gradient and P/F ratio as approximate.' + (d.fio2Estimated.warn ? ' ' + d.fio2Estimated.warn : ''));
      }
      out.steps.push({
        id: 'oxygenation', title: 'Assess oxygenation',
        tone: (hypox || (!roomAir && ards) || (roomAir && AaHigh)) ? 'warn' : 'normal',
        verdict: roomAir
          ? (hypox ? (hypox.charAt(0).toUpperCase() + hypox.slice(1)) + ' hypoxemia, ' + (AaHigh ? 'widened A–a' : 'normal A–a') : (AaHigh ? 'Widened A–a gradient' : 'Normal oxygenation'))
          : (ards ? 'P/F ' + f(PF, 0) + ': ' + ards + ' impairment' : 'P/F ' + f(PF, 0) + ': adequate'),
        detail: oxDetail.join(' '),
        formula: [
          (patmFromAlt ? 'Patm at ' + f(v.altitude, 0) + ' ft ≈ 760 × (1 − 6.88×10⁻⁶ × ft)^5.256 = ' + f(patm, 0) + ' mmHg\n' : v.Patm === null ? 'Assumes sea level (Patm 760 mmHg). Enter altitude or barometric pressure under settings if the patient is higher up.\n' : '') + 'PAO₂ = FiO₂ × (Patm − 47) − PaCO₂ ÷ 0.8 = ' + f(fio2, 2) + ' × (' + f(patm, 0) + ' − 47) − ' + f(co2) + ' ÷ 0.8 = ' + f(PAO2),
          'A–a gradient = PAO₂ − PaO₂ = ' + f(PAO2) + ' − ' + f(v.PaO2) + ' = ' + f(Aa),
          expAa !== null ? 'Expected A–a on room air ≈ age ÷ 4 + 4 = ' + f(expAa) : 'Enter age for an age-adjusted A–a norm (≈ age ÷ 4 + 4)',
          'P/F = PaO₂ ÷ FiO₂ = ' + f(v.PaO2) + ' ÷ ' + f(fio2, 2) + ' = ' + f(PF, 0)
        ],
        ddx: ((hypox || AaHigh) ? [
          'Normal A–a: hypoventilation, low inspired O₂ (altitude)',
          'Widened A–a, corrects with O₂: V/Q mismatch (COPD, asthma, pneumonia, PE), diffusion limitation (ILD)',
          'Widened A–a, poor response to O₂: shunt (ARDS, lobar collapse, intracardiac shunt, AVM)'
        ] : []).concat(v.COHb === null && v.MetHb === null ? ['A normal PaO₂ does not rule out carbon monoxide or methemoglobin. Ask for co-oximetry (COHb, MetHb) with smoke exposure, headache, or unexplained cyanosis.'] : [])
      });
    }

    // ---------- Summary ----------
    // If compensation fits a single disorder, the other abnormal value is compensation, not a second primary answer
    if (d.appropriate && out.primaryKeys.length > 1) out.primaryKeys = [primary];
    out.steps.forEach(function (st) {
      if (st.ddx || !st.verdict) return;
      if (/Concomitant respiratory acidosis/.test(st.verdict)) st.ddx = DDX.respacid;
      else if (/Concomitant respiratory alkalosis/.test(st.verdict)) st.ddx = DDX.respalk;
      else if (/Concomitant metabolic alkalosis/.test(st.verdict)) st.ddx = DDX.metalk;
      else if (/Concomitant normal anion gap/.test(st.verdict)) st.ddx = DDX.nagma;
      else if (/Concomitant metabolic acidosis/.test(st.verdict)) st.ddx = has('hagma') ? DDX.hagma : has('nagma') ? DDX.nagma : DDX.metacid;
    });
    // Venous sample: no oxygenation read
    if (out.venous) {
      out.steps.push({ id: 'oxygenation', title: 'Assess oxygenation', tone: 'info', verdict: 'Not assessed on a venous gas',
        detail: 'Venous PO₂ reflects tissue oxygen extraction, not lung function. Use SpO₂ for oxygenation, or draw an arterial gas if you need a PaO₂, A–a gradient or P/F ratio.' + (out.rawVenous && out.rawVenous.PO2 !== null ? ' The PO₂ entered (' + f(out.rawVenous.PO2, 0) + ') was not used.' : ''),
        formula: null });
    }

    // Mechanical ventilation context (interpretation only; no setting recommendations)
    if (out.ventilatedFlag) {
      const vl = [], vf = [], vVerd = []; let vTone = 'info';
      const rrUse = v.totalRR !== null ? v.totalRR : v.setRR; let pbw = null, VE = null, extraRR = null;
      if (v.heightCm !== null && (input.sex === 'm' || input.sex === 'f')) {
        pbw = (input.sex === 'm' ? 50 : 45.5) + 0.91 * (v.heightCm - 152.4); d.PBW = pbw;
        vf.push('Predicted body weight = ' + (input.sex === 'm' ? '50' : '45.5') + ' + 0.91 × (' + f(v.heightCm, 0) + ' − 152.4) = ' + f(pbw) + ' kg');
      }
      if (v.Vt !== null && rrUse !== null) { VE = rrUse * v.Vt / 1000; d.VE = VE; vf.push('Minute ventilation = ' + (v.totalRR !== null ? 'total' : 'set') + ' rate × Vt = ' + f(rrUse, 0) + ' × ' + f(v.Vt, 0) + ' mL = ' + f(VE) + ' L/min'); }
      if (pbw !== null && v.Vt !== null) { d.VtPBW = v.Vt / pbw; vf.push('Tidal volume = ' + f(v.Vt, 0) + ' ÷ ' + f(pbw) + ' = ' + f(d.VtPBW) + ' mL/kg PBW (lung-protective range commonly 4–8)'); }
      // Patient–ventilator rate mismatch
      if (v.setRR !== null && v.totalRR !== null) {
        extraRR = v.totalRR - v.setRR; d.extraRR = extraRR;
        vf.push('Breaths above the set rate = ' + f(v.totalRR, 0) + ' − ' + f(v.setRR, 0) + ' = ' + f(extraRR, 0) + ' per minute');
        if (extraRR > 4) { vTone = 'warn'; vVerd.push('Breathing above the set rate'); vl.push('The patient is triggering about ' + f(extraRR, 0) + ' breaths per minute above the set rate of ' + f(v.setRR, 0) + '. Common drivers include pain, agitation or anxiety, hypoxemia, fever or sepsis, metabolic acidosis (respiratory compensation), and patient–ventilator dyssynchrony.'); }
        else vl.push('The patient is breathing at or near the set rate, so the ventilator settings are largely determining minute ventilation.');
      }
      // Ventilator as a cause of a respiratory disorder
      if (has('respalk')) {
        if (extraRR === null || extraRR <= 4) { vTone = 'warn'; vVerd.push('Hypocapnia at the set rate'); vl.push('A respiratory alkalosis while the patient breathes at the set rate points to the delivered ventilation' + (VE !== null ? ' (' + f(VE) + ' L/min)' : '') + ' as its cause, rather than the patient\'s own drive.'); }
        else vl.push('The respiratory alkalosis comes with extra patient-triggered breaths, so the patient\'s own drive is contributing.');
      }
      if (has('respacid')) {
        vVerd.push('Hypercapnia on the ventilator');
        vl.push('In a ventilated patient, PaCO₂ reflects delivered minute ventilation' + (VE !== null ? ' (' + f(VE) + ' L/min)' : '') + ' relative to CO₂ production and dead space. A respiratory acidosis here can come from the ventilator settings, increased CO₂ production (fever, shivering, seizures, high carbohydrate intake), or increased dead space.');
      }
      // Clinical context
      const ctx = input.context;
      if (ctx === 'ards') {
        vVerd.push('Lung-protective ventilation');
        vl.push('Lung-protective ventilation uses low tidal volumes, commonly 4–8 mL/kg PBW' + (d.VtPBW !== undefined ? ' (here ' + f(d.VtPBW) + ')' : '') + ', and often raises PaCO₂ deliberately (permissive hypercapnia). The ARDSNet protocol aimed for a pH of 7.30–7.45 and tolerated lower values in some circumstances.' + (has('respacid') ? ' The respiratory acidosis may be an expected result of this strategy rather than a new problem.' : ''));
      } else if (ctx === 'tbi') {
        vVerd.push('Brain injury');
        vl.push('In traumatic brain injury, Brain Trauma Foundation guidelines recommend against prolonged prophylactic hyperventilation to a PaCO₂ of 25 mmHg or less; normocapnia (about 35–45 mmHg) is the usual aim, with brief hyperventilation reserved as a temporizing measure for raised intracranial pressure.' + (co2 >= 35 && co2 <= 45 && has('respacid') ? ' PaCO₂ ' + f(co2) + ' is within that range, so the respiratory acidosis reflects ventilation deliberately not compensating for the metabolic acidosis.' : co2 < 35 ? ' PaCO₂ ' + f(co2) + ' is below that range.' : ''));
      }
      // Post-hypercapnic alkalosis
      if (v.usualPaCO2 !== null && co2 < v.usualPaCO2 - 5 && hco3 > 26) {
        vTone = 'warn'; vVerd.push('Post-hypercapnic pattern');
        vl.push('PaCO₂ ' + f(co2) + ' is well below this patient\'s usual ' + f(v.usualPaCO2) + ' while HCO₃⁻ is still ' + f(hco3) + ': the pattern of post-hypercapnic metabolic alkalosis, seen when a chronic CO₂ retainer is ventilated toward a normal PaCO₂ before the kidneys have excreted the retained bicarbonate.');
      }
      if (!vl.length) vl.push('Enter the set rate, total rate and tidal volume to relate the PaCO₂ to the delivered ventilation.');
      out.steps.push({ id: 'ventilator', title: 'Consider the ventilator', tone: vTone, verdict: vVerd.length ? vVerd.join(' · ') : 'Mechanically ventilated', detail: vl.join(' '), formula: vf.length ? vf : null });
    }

    // Saturation and co-oximetry
    if ([v.SaO2, v.SpO2, v.COHb, v.MetHb, v.Hb].some(function (x) { return x !== null; })) {
      const coLines = [], coForm = [], coVerdict = []; let coTone = 'normal';
      if (v.COHb !== null) {
        coForm.push('COHb normal < 3% (non-smokers); smokers up to about 10%');
        if (v.COHb >= 10) {
          coTone = 'acid'; coVerdict.push('Carbon monoxide poisoning');
          coLines.push('COHb ' + f(v.COHb) + '% indicates carbon monoxide poisoning. PaO₂ and pulse oximetry are falsely reassuring because CO-bound hemoglobin carries no oxygen and reads as oxyhemoglobin on a standard pulse oximeter.');
          out.alerts.push({ title: 'Carbon monoxide: COHb ' + f(v.COHb) + '%', text: 'This level is consistent with carbon monoxide poisoning. PaO₂ and standard pulse oximetry do not reflect oxygen content when COHb is raised.' + (v.lactate !== null && v.lactate >= 8 ? ' After smoke exposure, a lactate of 8 or more (here ' + f(v.lactate) + ') has been associated with cyanide toxicity.' : '') });
        } else if (v.COHb >= 3) {
          if (coTone === 'normal') coTone = 'warn'; coVerdict.push('COHb mildly raised');
          coLines.push('COHb ' + f(v.COHb) + '% is above the non-smoker normal. Smokers can run up to about 10%; otherwise consider carbon monoxide exposure.');
        } else coLines.push('COHb ' + f(v.COHb) + '% is normal.');
      }
      if (v.MetHb !== null) {
        coForm.push('MetHb normal < 2%; symptoms usually above 10–15%');
        if (v.MetHb >= 10) {
          coTone = 'acid'; coVerdict.push('Methemoglobinemia');
          coLines.push('MetHb ' + f(v.MetHb) + '%: methemoglobin cannot carry oxygen, so oxygen delivery is reduced even with a normal PaO₂. Pulse oximetry often reads near 85% regardless of the true saturation.');
          out.alerts.push({ title: 'Methemoglobinemia: MetHb ' + f(v.MetHb) + '%', text: 'Methemoglobin does not carry oxygen, and standard pulse oximetry is unreliable at this level. Oxidizing drugs are a common cause (dapsone, benzocaine or lidocaine sprays, nitrates, rasburicase).' });
        } else if (v.MetHb >= 2) {
          if (coTone === 'normal') coTone = 'warn'; coVerdict.push('MetHb mildly raised');
          coLines.push('MetHb ' + f(v.MetHb) + '% is mildly raised; recheck if symptoms or exposure fit.');
        } else coLines.push('MetHb ' + f(v.MetHb) + '% is normal.');
      }
      if (!out.venous && v.SpO2 !== null && v.SaO2 !== null) {
        const satGap = v.SpO2 - v.SaO2; d.satGap = satGap;
        coForm.push('Saturation gap = SpO₂ − SaO₂ = ' + f(v.SpO2) + ' − ' + f(v.SaO2) + ' = ' + f(satGap) + ' (normal < 5)');
        if (satGap >= 5) { coTone = coTone === 'acid' ? 'acid' : 'warn'; coVerdict.push('Saturation gap ' + f(satGap)); coLines.push('The pulse oximeter reads ' + f(satGap) + ' points higher than the measured SaO₂. A saturation gap of 5 or more points to carbon monoxide or methemoglobin.'); }
      }
      if (!out.venous && v.SaO2 !== null && v.PaO2 !== null) {
        const P = v.PaO2, expSat = 100 / (1 + 23400 / (P * P * P + 150 * P)); d.expSaO2 = expSat;
        coForm.push('SaO₂ expected from PaO₂ ' + f(P, 0) + ' (standard curve) ≈ ' + f(expSat, 0) + '%; measured ' + f(v.SaO2) + '%');
        if (expSat - v.SaO2 >= 5) { coTone = coTone === 'acid' ? 'acid' : 'warn'; coVerdict.push('SaO₂ lower than PaO₂ predicts'); coLines.push('The measured SaO₂ (' + f(v.SaO2) + '%) is well below the ' + f(expSat, 0) + '% the PaO₂ predicts. Suspect an abnormal hemoglobin (COHb, MetHb) or a sampling error. Make sure the SaO₂ is measured by co-oximetry, not calculated from the PaO₂.'); }
      }
      if (!out.venous && v.Hb !== null && v.SaO2 !== null) {
        const CaO2 = 1.34 * v.Hb * v.SaO2 / 100 + 0.003 * (v.PaO2 !== null ? v.PaO2 : 0); d.CaO2 = CaO2;
        coForm.push('CaO₂ = 1.34 × Hb × SaO₂ + 0.003 × PaO₂ = 1.34 × ' + f(v.Hb) + ' × ' + f(v.SaO2 / 100, 2) + ' + 0.003 × ' + f(v.PaO2 !== null ? v.PaO2 : 0, 0) + ' = ' + f(CaO2) + ' mL O₂/dL (normal about 17–20)');
        if (CaO2 < 15) { coTone = coTone === 'acid' ? 'acid' : 'warn'; coVerdict.push('Low O₂ content'); coLines.push('Arterial oxygen content is low (' + f(CaO2) + ' mL/dL) ' + (v.Hb < 10 ? 'mainly from anemia (Hb ' + f(v.Hb) + ')' : 'from low saturation') + ', so oxygen delivery is reduced even if the PaO₂ looks fine.'); }
      }
      if (coLines.length) {
        out.steps.push({ id: 'saturation', title: 'Check oxygen-carrying capacity', tone: coTone,
          verdict: coVerdict.length ? coVerdict.join(' · ') : 'No abnormal hemoglobin',
          detail: coLines.join(' '), formula: coForm,
          ddx: coTone !== 'normal' ? ['Carbon monoxide: fires, faulty heaters, generators or engines in enclosed spaces; often several people in one home affected', 'Methemoglobin: dapsone, topical benzocaine or lidocaine, nitrates or nitrites, rasburicase, primaquine; rarely congenital', 'Anemia: blood loss, hemolysis, marrow failure'] : null });
      }
    }

    // Mixed-disorder patterns
    const matched = MIXED.filter(function (m) { return has(m.a) && has(m.b); });
    if (matched.length) {
      const mixStep = {
        id: 'mixed', title: matched.length > 1 ? 'Recognize the mixed patterns' : 'Recognize the mixed pattern', tone: 'info',
        verdict: matched.length > 1 ? matched.length + ' mixed patterns' : matched[0].name,
        detail: (matched.length > 1 ? matched.map(function (m) { return m.name + ' (typically ' + m.pattern + ')'; }).join('; ') + '.' : matched[0].name + ': typically ' + matched[0].pattern + '.') + ' Common clinical settings are listed below; use them to connect the numbers to the patient.',
        formula: null,
        ddx: matched.length > 1 ? matched.map(function (m) { return m.name + ': ' + m.causes.join('; '); }) : matched[0].causes
      };
      const firstFollow = out.steps.findIndex(function (st) { return ['toxscreen', 'osm', 'uag', 'ucl', 'oxygenation'].indexOf(st.id) >= 0; });
      if (firstFollow < 0) out.steps.push(mixStep); else out.steps.splice(firstFollow, 0, mixStep);
    }
    out.summary = buildSummary(out, primary);
    return out;
  }

  function buildSummary(out, primary) {
    const d = out.derived;
    if (out.disorders.length === 0) return 'Normal acid–base status';
    const primaries = out.disorders.filter(function (x) { return x.role === 'primary'; });
    const others = out.disorders.filter(function (x) { return x.role !== 'primary'; });
    others.sort(function (a, b) { return (isMetKey(a.key) ? 0 : 1) - (isMetKey(b.key) ? 0 : 1); });
    let s;
    if (primaries.length === 0) {
      s = others.map(function (x) { return x.label.toLowerCase(); }).join(' and ');
      s = s.charAt(0).toUpperCase() + s.slice(1);
      if (d.status === 'normal') s += ', masked by a normal pH';
      return s;
    }
    const names = primaries.map(function (x) { return (x.qualifier && x.qualifier !== 'acute or chronic' ? x.qualifier + ' ' : '') + x.label.toLowerCase(); });
    if (names.length === 2) s = 'Combined ' + names[0].replace(/ (acidosis|alkalosis)$/, '') + ' and ' + names[1];
    else s = 'Primary ' + names[0];
    if (d.appropriate && primaries.length === 1) {
      const q = primaries[0].qualifier;
      if (q === 'acute') s += ' (uncompensated, as expected acutely)';
      else if (q === 'acute-on-chronic' || q === 'subacute') s += '';
      else s += d.borderline ? ', appropriately compensated (borderline)' : ', appropriately compensated';
    }
    if (others.length) s += ', with ' + others.map(function (x) { return x.label.toLowerCase(); }).join(' and ');
    return s;
  }

  function isMetKey(k) { return k === 'metacid' || k === 'hagma' || k === 'nagma' || k === 'metalk'; }

  /*
   * Estimate FiO2 (%) from an oxygen delivery device and flow (L/min).
   * Rules of thumb; true FiO2 varies with the patient's minute ventilation.
   *  - Nasal cannula: 20% + 4% per L/min (1-6 L/min; 24-44%)
   *  - Simple face mask: 5-10 L/min, about 40-60% (40% + 4% per L above 5)
   *  - Non-rebreather: 10-15 L/min, about 60-80% (60% + 4% per L above 10)
   */
  const DEVICES = {
    ra: { name: 'room air' },
    nc: { name: 'nasal cannula', min: 1, max: 6 },
    mask: { name: 'simple face mask', min: 5, max: 10 },
    nrb: { name: 'non-rebreather mask', min: 10, max: 15 }
  };
  function estimateFiO2(device, flow) {
    flow = num(flow);
    if (device === 'ra') return { fio2: 21, note: 'Room air: FiO₂ 21%.', warn: null };
    const dv = DEVICES[device]; if (!dv) return null;
    if (flow === null || flow <= 0) return { fio2: null, note: null, warn: 'Enter the flow in L/min for the ' + dv.name + '.' };
    const used = Math.min(Math.max(flow, dv.min), dv.max); let fio2, rule;
    if (device === 'nc') { fio2 = 20 + 4 * used; rule = '20% + 4% × ' + f(used) + ' L/min'; }
    else if (device === 'mask') { fio2 = 40 + 4 * (used - 5); rule = '40% + 4% × (' + f(used) + ' − 5) L/min'; }
    else { fio2 = 60 + 4 * (used - 10); rule = '60% + 4% × (' + f(used) + ' − 10) L/min'; }
    let warn = null;
    if (flow > dv.max) warn = 'Flows above ' + dv.max + ' L/min on a ' + dv.name + ' add little FiO₂; capped at ' + f(fio2, 0) + '%.' + (device === 'nc' ? ' For higher needs, record the device (mask, high-flow) and its set FiO₂.' : '');
    else if (flow < dv.min) warn = device === 'nc' ? 'Below 1 L/min the estimate is unreliable.' : 'A ' + dv.name + ' needs at least ' + dv.min + ' L/min' + (device === 'mask' ? ' to flush exhaled CO₂.' : ' to keep the reservoir bag inflated.');
    return { fio2: fio2, note: 'Estimated FiO₂ ≈ ' + f(fio2, 0) + '% from ' + f(flow) + ' L/min by ' + dv.name + ' (' + rule + ').', warn: warn };
  }

  // Common clinical settings for mixed disorders, shown when both disorders are present
  const MIXED = [
    { a: 'respacid', b: 'metacid', name: 'Respiratory acidosis with metabolic acidosis', pattern: '↓ pH, ↓ HCO₃⁻, ↑ PaCO₂', causes: ['Cardiac arrest', 'Intoxications', 'Multi-organ failure'] },
    { a: 'respalk', b: 'metalk', name: 'Respiratory alkalosis with metabolic alkalosis', pattern: '↑ pH, ↑ HCO₃⁻, ↓ PaCO₂', causes: ['Cirrhosis with diuretics', 'Pregnancy with vomiting', 'Over-ventilation of COPD'] },
    { a: 'respacid', b: 'metalk', name: 'Respiratory acidosis with metabolic alkalosis', pattern: 'pH in normal range, ↑ PaCO₂, ↑ HCO₃⁻', causes: ['COPD with diuretics, vomiting, NG suction', 'Severe hypokalemia'] },
    { a: 'respalk', b: 'metacid', name: 'Respiratory alkalosis with metabolic acidosis', pattern: 'pH in normal range, ↓ PaCO₂, ↓ HCO₃⁻', causes: ['Sepsis', 'Salicylate toxicity', 'Renal failure with CHF or pneumonia', 'Advanced liver disease'] },
    { a: 'metacid', b: 'metalk', name: 'Metabolic acidosis with metabolic alkalosis', pattern: 'pH in normal range, HCO₃⁻ normal', causes: ['Uremia or ketoacidosis with vomiting, NG suction, diuretics, etc.'] }
  ];

  const API = { MIXED: MIXED, LIMITS: LIMITS, interpret: interpret, estimateFiO2: estimateFiO2, DEVICES: DEVICES, NORMAL: NORMAL, LABELS: LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ABG = API;
})(typeof window !== 'undefined' ? window : this);
