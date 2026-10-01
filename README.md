# pHormula

pHormula: a stepwise arterial blood gas (ABG) interpreter. Plain HTML, CSS and JavaScript: no frameworks, no build step, no server.

## Run it
Open `index.html` in any browser. To put it online, upload the whole folder to any static host (GitHub Pages, Netlify, S3, a hospital intranet web server).

## Files
- `index.html`: page structure (form, tabs, results area)
- `styles.css`: all styling, including light and dark themes
- `js/abg-engine.js`: the interpretation logic. Pure functions, no page code. Change clinical rules here.
- `js/abg-cases.js`: practice cases with expected answers
- `js/app.js`: connects the form to the engine and draws the results
- `test.js`: checks every practice case and edge case against the engine: `node test.js` (needs Node.js)

## What the engine does
1. Rejects values outside accepted ranges (e.g. pH 6.50–8.00, FiO₂ 21–100%) and flags likely unit errors (kPa, mmol/L)
2. Checks internal consistency with the Henderson–Hasselbalch equation, pH = 6.1 + log₁₀(HCO₃⁻ ÷ (0.03 × PaCO₂)), accepting a predicted pH within 0.05 of the reported pH
3. Classifies the pH and finds the primary process
4. Checks compensation (Winter's; 0.7 rule for metabolic alkalosis; 1/3.5 and 2/4 per 10 mmHg for respiratory), with a ±2 range and a 1-unit borderline zone
5. Adds the classic label (uncompensated / partially / fully compensated)
6. Anion gap (albumin-corrected or lab-reported), lactate, K⁺, delta ratio
7. Prompts for an osmolal gap when a gap acidosis is unexplained; urine anion gap and urine chloride
8. Oxygenation: FiO₂ from device and flow, A–a gradient (age- and altitude-aware), P/F ratio
9. Co-oximetry: COHb and MetHb alerts, saturation gap (SpO₂ − SaO₂), SaO₂ vs PaO₂, arterial O₂ content
10. Venous gases: converts to estimated arterial values (pH +0.03, PCO₂ −5, HCO₃⁻ −1) and skips oxygenation
11. Patient baseline: usual PaCO₂ and HCO₃⁻ for chronic CO₂ retainers, used for compensation and the delta calculations
12. Ventilator context: minute ventilation, tidal volume per kg PBW, breaths above the set rate, ventilator-driven hypo/hypercapnia, post-hypercapnic pattern, ARDS and TBI guideline context, PEEP-aware Berlin grading

## Intended use (regulatory design)
pHormula is built to fit FDA's criteria for non-device clinical decision support software:
- It displays and analyzes lab values and does not process images or device signals.
- It is for licensed clinicians and trainees, and supports rather than replaces their judgment.
- Every result shows its formula, inputs and threshold, so the clinician can independently review the basis.
- It makes no treatment or ventilator-setting recommendations and stores no patient data.

Keep these properties when making changes: add findings and reference context, not instructions. Get a regulatory review before marketing or deploying it clinically.
