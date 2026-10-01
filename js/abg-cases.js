/* Practice cases. Values are chosen to be internally consistent (Henderson–Hasselbalch, predicted pH within 0.05). */
(function (root) {
  const CASES = [
    {
      id: 'dka', title: 'Fruity breath and Kussmaul breathing',
      vignette: '19-year-old with type 1 diabetes, 2 days of vomiting and abdominal pain. Deep, rapid respirations. Glucose 520 mg/dL.',
      values: { pH: 7.12, PaCO2: 18, HCO3: 6, Na: 134, Cl: 98, albumin: 4.0, glucose: 520, BUN: 28, PaO2: 105, FiO2: 21, age: 19 },
      teaching: 'Pure high anion gap acidosis with appropriate Winter\'s compensation. Delta ratio about 1 is typical of ketoacidosis.',
      expect: { primary: 'metacid', has: ['hagma'], not: ['nagma', 'metalk', 'respacid', 'respalk'] }
    },
    {
      id: 'diarrhea', title: 'Two weeks of watery stools',
      vignette: '45-year-old with 2 weeks of profuse watery diarrhea after travel. Orthostatic, mucous membranes dry.',
      values: { pH: 7.30, PaCO2: 31, HCO3: 15, Na: 138, Cl: 115, albumin: 4.0, UNa: 30, UK: 25, UCl: 75, PaO2: 95, FiO2: 21, age: 45 },
      teaching: 'Normal anion gap acidosis with a negative urine anion gap: the kidney is excreting ammonium, so the bicarbonate was lost from the gut.',
      expect: { primary: 'metacid', has: ['nagma'], not: ['hagma', 'respacid', 'respalk'] }
    },
    {
      id: 'vomiting', title: 'Pyloric obstruction',
      vignette: '62-year-old with gastric outlet obstruction, vomiting for 5 days. BP 102/64, K⁺ 2.9.',
      values: { pH: 7.51, PaCO2: 48, HCO3: 37, Na: 136, Cl: 88, albumin: 4.0, UCl: 10, PaO2: 82, FiO2: 21, age: 62 },
      teaching: 'Metabolic alkalosis with appropriate hypoventilation. Urine chloride under 20 says chloride-responsive: it corrects with saline and potassium.',
      expect: { primary: 'metalk', has: ['metalk'], not: ['respacid', 'respalk', 'hagma'] }
    },
    {
      id: 'opioid', title: 'Found down with pinpoint pupils',
      vignette: '30-year-old found unresponsive, respiratory rate 6, pinpoint pupils. Room air.',
      values: { pH: 7.21, PaCO2: 70, HCO3: 27, Na: 140, Cl: 103, albumin: 4.2, PaO2: 58, FiO2: 21, age: 30 },
      teaching: 'Acute respiratory acidosis: HCO₃⁻ has risen only 1 per 10 mmHg. The hypoxemia has a normal A–a gradient, so it is fully explained by hypoventilation.',
      expect: { primary: 'respacid', qualifier: 'acute', not: ['metacid', 'hagma', 'nagma', 'metalk'] }
    },
    {
      id: 'copd', title: 'Longstanding COPD, clinic visit',
      vignette: '68-year-old with severe COPD on home oxygen at 2 L (FiO₂ about 28%). At his baseline today.',
      values: { pH: 7.33, PaCO2: 60, HCO3: 31, Na: 140, Cl: 98, albumin: 3.8, PaO2: 55, FiO2: 28, age: 68 },
      teaching: 'Chronic respiratory acidosis: HCO₃⁻ has risen about 3.5 per 10 mmHg of PaCO₂, so the kidneys have had days to compensate.',
      expect: { primary: 'respacid', qualifier: 'chronic', not: ['metacid', 'hagma', 'metalk'] }
    },
    {
      id: 'pe', title: 'Sudden pleuritic chest pain',
      vignette: '40-year-old, 3 days after a long flight, sudden dyspnea and pleuritic chest pain. HR 118. Room air.',
      values: { pH: 7.52, PaCO2: 28, HCO3: 22, Na: 139, Cl: 105, albumin: 4.1, PaO2: 68, FiO2: 21, age: 40 },
      teaching: 'Acute respiratory alkalosis. The mild hypoxemia comes with a widened A–a gradient, which points to the lung (here a pulmonary embolism) rather than hypoventilation.',
      expect: { primary: 'respalk', qualifier: 'acute', not: ['metacid', 'metalk'] }
    },
    {
      id: 'salicylate', title: 'Tinnitus after a bottle of aspirin',
      vignette: '24-year-old brought in after an intentional ingestion. Ringing in the ears, vomiting, tachypneic.',
      values: { pH: 7.45, PaCO2: 22, HCO3: 15, Na: 140, Cl: 103, albumin: 4.0, PaO2: 110, FiO2: 21, age: 24 },
      teaching: 'Near-normal pH with both PaCO₂ and HCO₃⁻ far from normal is the tell for a mixed disorder. Salicylates stimulate the respiratory center and generate a gap acidosis at the same time.',
      expect: { primaryAny: ['respalk', 'metacid'], has: ['hagma', 'respalk'] }
    },
    {
      id: 'hidden', title: 'Alcohol binge, then vomiting',
      vignette: '52-year-old with heavy alcohol use, 3 days of vomiting and no oral intake. Looks unwell, but the gas is "normal".',
      values: { pH: 7.40, PaCO2: 40, HCO3: 24, Na: 140, Cl: 90, albumin: 4.0, PaO2: 92, FiO2: 21, age: 52 },
      teaching: 'Always calculate the gap. An AG of 26 with a normal HCO₃⁻ means alcoholic ketoacidosis and a vomiting alkalosis are cancelling each other out.',
      expect: { primaryAny: ['none'], has: ['hagma', 'metalk'] }
    },
    {
      id: 'albumin', title: 'Septic shock in cirrhosis',
      vignette: '58-year-old with cirrhosis and spontaneous bacterial peritonitis, hypotensive, received 6 L of 0.9% saline.',
      values: { pH: 7.29, PaCO2: 30, HCO3: 14, Na: 136, Cl: 110, albumin: 2.0, PaO2: 88, FiO2: 21, age: 58 },
      teaching: 'The raw anion gap of 12 looks normal until you correct for albumin 2.0. Then a lactic HAGMA appears, and the delta ratio under 1 shows a saline-induced NAGMA on top.',
      expect: { primary: 'metacid', has: ['hagma', 'nagma'], not: ['respacid', 'respalk'] }
    },
    {
      id: 'ards', title: 'Tiring on the ward',
      vignette: '71-year-old with pneumonia and sepsis, now on 60% oxygen by high-flow, becoming drowsy. Lactate 5.',
      values: { pH: 7.27, PaCO2: 40, HCO3: 18, Na: 138, Cl: 100, albumin: 3.4, lactate: 5, PaO2: 72, FiO2: 60, age: 71 },
      teaching: 'A "normal" PaCO₂ of 40 is too high for this acidosis: Winter\'s predicts 33–37. The patient is tiring. P/F of 120 is in the moderate ARDS range.',
      expect: { primary: 'metacid', has: ['hagma', 'respacid'] }
    }
    ,{
      id: 'tbi', title: 'Ventilated after head injury',
      vignette: 'Young adult sedated and mechanically ventilated after a traumatic brain injury, on a noradrenaline infusion and receiving hypertonic saline. Blood pressure is hard to maintain.',
      values: { pH: 7.10, PaCO2: 35, HCO3: 11, Na: 146, Cl: 129, K: 3.2, lactate: 4.9, PaO2: 169, FiO2: 40, age: 30, vent: true, setRR: 16, totalRR: 16, Vt: 500, PEEP: 8, heightCm: 178, sex: 'm', context: 'tbi' },
      teaching: 'A triple disturbance. The calculated anion gap is only 6, but lactate 4.9 proves a lactic HAGMA, and the rest of the bicarbonate deficit is a hyperchloremic NAGMA (hypertonic saline; hypokalemia raises the possibility of distal RTA). Winter\'s predicts a PaCO₂ of about 25, so a "normal" 35 on the ventilator is a respiratory acidosis. A low-normal PaCO₂ is often targeted in TBI to avoid cerebral vasoconstriction.',
      expect: { primary: 'metacid', has: ['nagma', 'hagma', 'respacid'], not: ['metalk', 'respalk'] }
    }
    ,{
      id: 'altitude', title: 'Three weeks at 15,000 feet',
      vignette: '40-year-old mountain climber who has spent 3 weeks at 15,000 ft for a research project. Feels well. Reported anion gap 11.',
      values: { pH: 7.44, PaCO2: 24, HCO3: 16, AGrep: 11, PaO2: 55, FiO2: 21, age: 40, altitude: 15000 },
      teaching: 'Chronic respiratory alkalosis from the hypoxic drive to breathe. After 3 weeks the kidneys have excreted bicarbonate (about 4 per 10 mmHg fall in PaCO₂), bringing the pH almost back to normal. The low HCO₃⁻ is compensation, not a separate metabolic acidosis, and the normal anion gap agrees. Chronic respiratory alkalosis is the one disorder that can fully normalize the pH. At 15,000 ft the A–a gradient is normal: the hypoxemia is from thin air, not lung disease.',
      expect: { primary: 'respalk', qualifier: 'chronic', not: ['metacid', 'hagma', 'nagma', 'metalk'] }
    }
    ,{
      id: 'gi-loss', title: 'A day of profuse diarrhea',
      vignette: '40-year-old woman with multiple loose bowel movements over one day. Seen in the ER on room air. Reported anion gap 10.',
      values: { pH: 7.35, PaCO2: 32, HCO3: 18, AGrep: 10, PaO2: 75, FiO2: 21, age: 40 },
      teaching: 'Normal anion gap acidosis from bicarbonate lost in stool. Winter\'s predicts a PaCO₂ of 33–37, and 32 is within measurement error of that, so this is appropriate compensation. Respiratory compensation begins within minutes to hours, which is why the pH is already near normal after one day. Renal compensation for a respiratory disorder takes days.',
      expect: { primary: 'metacid', has: ['nagma'], not: ['respalk', 'respacid', 'hagma', 'metalk'] }
    }
    ,{
      id: 'hagma-alk', title: 'Gap acidosis hiding an alkalosis',
      vignette: 'Unwell adult; no further history given. Na⁺ 140, K⁺ 4, Cl⁻ 96. FiO₂ not recorded.',
      values: { pH: 7.25, PaCO2: 27, HCO3: 12, Na: 140, K: 4, Cl: 96, PaO2: 99 },
      teaching: 'Winter\'s predicts a PaCO₂ of 24–28, so compensation is appropriate. The anion gap is 32, up 20, but HCO₃⁻ fell only 12. Delta gap +8 (above +6) and a corrected HCO₃⁻ of 32 reveal a metabolic alkalosis alongside the gap acidosis, as with vomiting in DKA or alcoholic ketoacidosis. Note the delta ratio of 1.67 alone would look like a pure gap acidosis.',
      expect: { primary: 'metacid', has: ['hagma', 'metalk'], not: ['nagma', 'respacid', 'respalk'] }
    }
    ,{
      id: 'triple', title: 'Three disorders at once',
      vignette: 'Unwell adult; no further history given. Na⁺ 140, K⁺ 4, Cl⁻ 98. FiO₂ not recorded.',
      values: { pH: 7.15, PaCO2: 40, HCO3: 15, Na: 140, K: 4, Cl: 98, PaO2: 55 },
      teaching: 'A triple disorder. The anion gap is 27 (up 15) with HCO₃⁻ 15: a high anion gap acidosis. Winter\'s predicts a PaCO₂ of 28.5–32.5, so a "normal" 40 is a respiratory acidosis. HCO₃⁻ fell only 9 while the gap rose 15, so the corrected HCO₃⁻ is 30: a metabolic alkalosis is also present.',
      expect: { primary: 'metacid', has: ['hagma', 'metalk', 'respacid'], not: ['nagma', 'respalk'] }
    }
    ,{
      id: 'co', title: 'Pulled from a house fire',
      vignette: '35-year-old rescued from a smoke-filled house. Headache and confusion. SpO₂ reads 99% on room air.',
      values: { pH: 7.30, PaCO2: 32, HCO3: 15.5, Na: 140, Cl: 104, lactate: 5, PaO2: 95, FiO2: 21, age: 35, SpO2: 99, SaO2: 76, COHb: 22, Hb: 14 },
      teaching: 'The PaO₂ of 95 and SpO₂ of 99% look reassuring, but co-oximetry shows COHb 22% and a true SaO₂ of 76%: a saturation gap of 23. Oxygen content is low, tissues switch to anaerobic metabolism, and a lactic acidosis follows. Always ask for co-oximetry after smoke exposure.',
      expect: { primary: 'metacid', has: ['hagma'], not: ['respalk', 'respacid', 'metalk', 'nagma'], alert: 'Carbon monoxide' }
    }
    ,{
      id: 'vbg', title: 'DKA on a venous gas',
      vignette: '22-year-old with type 1 diabetes, vomiting and Kussmaul breathing. A venous gas is drawn with the first labs. Glucose 480 mg/dL.',
      values: { sample: 'venous', pH: 7.15, PaCO2: 27, HCO3: 9, Na: 135, Cl: 99, glucose: 480, BUN: 30 },
      teaching: 'A venous gas is enough to diagnose and follow DKA: add about 0.03 to the pH and subtract about 5 from the PCO₂ to estimate arterial values. Winter\'s is then satisfied, the anion gap is high, and no arterial puncture is needed unless oxygenation or ventilation is in question.',
      expect: { primary: 'metacid', has: ['hagma'], not: ['respacid', 'respalk', 'nagma'] }
    }
    ,{
      id: 'copd-baseline', title: 'COPD exacerbation with sepsis',
      vignette: '70-year-old CO₂ retainer whose usual clinic gas is PaCO₂ 55 and HCO₃⁻ 31. Now febrile, hypotensive and short of breath. Lactate 4.',
      values: { pH: 7.24, PaCO2: 60, HCO3: 25, Na: 140, Cl: 96, albumin: 4.0, lactate: 4, usualPaCO2: 55, usualHCO3: 31, PaO2: 58, FiO2: 28, age: 70 },
      teaching: 'On its own, HCO₃⁻ 25 looks like an acute respiratory acidosis. Against this patient\'s baseline (about 31.5 once the acute CO₂ rise is added), bicarbonate has fallen by about 6.5: a new metabolic acidosis. The anion gap of 19 has risen by 7, a matching amount, so this is a lactic gap acidosis from sepsis on top of acute-on-chronic hypercapnia.',
      expect: { primary: 'respacid', has: ['respacid', 'hagma'], not: ['metalk', 'nagma', 'respalk'] }
    }
    ,{
      id: 'posthypercapnic', title: 'Intubated CO₂ retainer',
      vignette: '66-year-old with severe COPD (usual PaCO₂ 60, HCO₃⁻ 34) intubated yesterday for hypercapnic respiratory failure. Ventilated at a set rate of 22, not triggering extra breaths.',
      values: { pH: 7.56, PaCO2: 38, HCO3: 33, Na: 139, Cl: 96, K: 3.4, PaO2: 88, FiO2: 35, age: 66, usualPaCO2: 60, usualHCO3: 34, vent: true, setRR: 22, totalRR: 22, Vt: 480, PEEP: 5, heightCm: 170, sex: 'm' },
      teaching: 'The kidneys have spent weeks retaining bicarbonate to match a PaCO₂ of 60. Ventilating this patient to a "normal" 38 leaves that bicarbonate unopposed: a post-hypercapnic metabolic alkalosis with a ventilator-driven respiratory alkalosis on top. The patient is breathing only at the set rate, so the low PaCO₂ comes from the ventilator settings.',
      expect: { primary: 'metalk', has: ['metalk', 'respalk'], not: ['respacid', 'metacid'], step: ['ventilator', 'Post-hypercapnic'] }
    }
    ,{
      id: 'lung-protective', title: 'ARDS on lung-protective ventilation',
      vignette: '52-year-old woman (165 cm) with influenza pneumonia and bilateral infiltrates, on volume control at 6 mL/kg with a set rate of 28 and PEEP 12.',
      values: { pH: 7.28, PaCO2: 62, HCO3: 28, Na: 138, Cl: 100, PaO2: 75, FiO2: 60, age: 52, vent: true, setRR: 28, totalRR: 28, Vt: 350, PEEP: 12, heightCm: 165, sex: 'f', context: 'ards' },
      teaching: 'A respiratory acidosis on low tidal volumes is often the intended trade-off of lung-protective ventilation (permissive hypercapnia). P/F of 125 on PEEP 12 falls in the moderate Berlin band. Whether this pH is acceptable is a bedside decision.',
      expect: { primary: 'respacid', has: ['respacid'], not: ['metacid', 'metalk'], step: ['ventilator', 'Lung-protective'] }
    }
    ,{
      id: 'everest', title: 'Near the summit of Everest',
      vignette: 'Acclimatized climber breathing ambient air at 8,400 m after weeks at altitude. Barometric pressure 272 mmHg, so the inspired PO₂ is only about 47 mmHg.',
      values: { pH: 7.53, PaCO2: 13.3, HCO3: 10.8, PaO2: 24.6, SaO2: 54, FiO2: 21, Patm: 272 },
      teaching: 'Moderate to severe alkalemia from extreme hyperventilation (PaCO₂ 13), profound hypoxemia, and a HCO₃⁻ of 10.8, below the usual floor of renal compensation, so a metabolic acidosis is also present. The expected alveolar PO₂ is only about 30 mmHg, so an A–a gradient of about 6 is increased for these conditions, suggesting diffusion limitation or subclinical high-altitude pulmonary edema.',
      expect: { primary: 'respalk', has: ['respalk', 'metacid'], not: ['respacid', 'metalk'], step: ['oxygenation', 'widened'] }
    }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = CASES;
  else root.ABG_CASES = CASES;
})(typeof window !== 'undefined' ? window : this);
