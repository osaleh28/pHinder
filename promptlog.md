# pHormula prompt log

A record of how pHormula (originally named pHinder), an arterial blood gas interpreter, was built with an AI assistant (Claude). Each entry lists the prompt, what the AI did, and the result. Entries marked **Human catch** are where Omar found an error or gap in the AI's work.

- **Builder:** Omar (physician, MBA)
- **AI assistant:** Claude, in Cowork
- **Dates:** September 29 – October 1, 2026
- **Final state:** 21 practice cases and edge-case tests, all passing; plain HTML, CSS and JavaScript; published page plus downloadable files

---

## Summary of human catches

| # | What Omar caught | What the AI had done wrong | Fix |
|---|---|---|---|
| 1 | TBI lab report: NAGMA + HAGMA + respiratory acidosis | Relied only on the anion gap (6), so it missed a lactic acidosis | Added lactate, K⁺ and a low-AG note |
| 2 | Partially compensated respiratory acidosis example | Only used compensation formulas, not the classic partial/full label | Added the classic read; warns when values are internally inconsistent |
| 3 | Mountain climber at 15,000 ft | Assumed sea level, so the A–a gradient looked widened | Added altitude and reported AG; fixed the practice answer key |
| 4 | "Don't assume FiO₂ is 21" | Silently assumed room air when no FiO₂ was entered | FiO₂ is now required for an A–a gradient and P/F ratio |
| 5 | Diarrhea example (PaCO₂ 32 vs expected 33–37) | Called a 1 mmHg miss a second disorder | Added a borderline zone to all compensation checks |
| 6 | "Make sure no one can put in a number outside the ranges" | Only pH, PaCO₂ and HCO₃⁻ were validated | Added limits to every field |
| 7 | Gap acidosis hiding a metabolic alkalosis (AG 32, HCO₃⁻ 12) | Delta ratio 1.67 looked "pure," so it missed the alkalosis | Added the delta gap and corrected HCO₃⁻ to the decision |
| 8 | Triple disorder (delta gap exactly +6) | Threshold of "> +6" missed it | Tightened to corrected HCO₃⁻ > 28, with a borderline band |
| 9 | Everest summit gas (PaCO₂ 13.3) | kPa rule rejected a real value; missed the metabolic acidosis and increased A–a | Consistency-based kPa check; HCO₃⁻ floor of 12; extreme-altitude A–a note |

---

## Day 1: September 29, 2026

### 1. Starting the project
> I want to create a web application that can correctly read arterial blood gasses.

- **AI:** Asked two clarifying questions. Omar chose all four scopes (core acid–base, anion gap and delta, oxygenation, teaching mode) and both delivery formats (hosted page and source code).
- **Result:** Built a pure-JavaScript interpretation engine, a web interface, an acid–base map, teaching mode, 10 practice cases and an automated test file. Published as "ABG Workbench."

### 2. Simplifying the display
> Get rid of the acid-base map, that is too confusing

- **Result:** Removed the map.

### 3. Background question
> can you explain the Henderson Hasselbalch equation

- **Result:** Explained the equation, the simpler Henderson form, and how the app's consistency check uses it.

### 4. Understanding the interface
> why is there an arrow at pH and PaCO2?

- **Result:** Explained that the arrows mark out-of-range values and that the color shows acid (red) or alkaline (indigo) direction.

### 5. Missing example values
> The previous example I gave should be a NAGMA + HAGMA + respiratory acidosis (triple acid base disturbance)

- **AI:** Could not see values typed into the page and asked for them.

### 6. TBI lab report (Human catch 1)
> [Image of a lab report: pH 7.10, pCO₂ 35, HCO₃⁻ 11, Na 146, Cl 129, K 3.2, lactate 4.9] Answer: triple disorder, NAGMA + HAGMA + respiratory acidosis.

- **AI error:** The engine had no lactate input. With an AG of 6, it called this a pure normal-gap acidosis.
- **Fix:** Added lactate (over 2 means a gap acidosis even with a normal AG), K⁺ clues for the NAGMA differential, a low-AG note, and the case "Ventilated after head injury."

### 7. Classic compensation labels (Human catch 2)
> pH 7.31, PaCO₂ 49, HCO₃ 30 … Therefore, we have PARTIALLY COMPENSATED RESPIRATORY ACIDOSIS.

- **AI finding:** The textbook values were internally inconsistent (they predict pH 7.41).
- **Fix:** Added the classic label (uncompensated, partially or fully compensated) alongside the formula-based read, plus a caution when inconsistent values produce a second disorder.

### 8. Mountain climber (Human catch 3)
> A 40 year-old mountain climber … 15,000 feet … pH 7.44, PCO₂ 24, PO₂ 55, HCO₃⁻ 16. Anion gap normal (11).

- **AI error:** The acid–base read was right, but the app assumed sea level and reported a widened A–a gradient.
- **Fix:** Added altitude, a reported-AG field and altitude-aware oxygenation text. Also fixed the practice answer key, which had accepted "metabolic acidosis" as primary. Added the case "Three weeks at 15,000 feet."

### 9. FiO₂ assumption (Human catch 4)
> Don't assume that the FiO2 is 21 and on room air. If they don't provide an FiO2, prompt them to provide them one to get an A-a gradient

- **Fix:** No FiO₂ now means no A–a gradient or P/F ratio. The FiO₂ field is highlighted and the oxygenation step asks for it.

### 10. Oxygen devices
> Can you add an how many liters of oxygen the patient is on and convert that to the FiO2?

- **Result:** Added an oxygen device and flow selector (room air, nasal cannula, simple mask, non-rebreather, set FiO₂). During testing, the AI corrected its own nasal cannula rule from 21% + 4% per L to the standard 20% + 4% per L.

### 11–13. Altitude and barometric pressure
> why do we need altitude and barometric?
> Do we really need altitude and barometric if this is for hospitals that are mostly at sea level?
> yes make that change

- **Result:** Explained the alveolar gas equation. Moved altitude into the collapsed settings section, removed the barometric field, and defaulted to sea level. Fixed a bug where the O₂ flow field showed with no device selected.

### 14–15. Clinical questions
> does age really matter?
> when would you calculate osmolal gap?

- **Result:** Explained the age-adjusted A–a gradient and the indications for an osmolal gap.

### 16–17. Toxic alcohol prompt
> is there a prompt to tell you that you should measure osmolar gap?
> yes build it

- **Result:** Added a prompt when a gap acidosis is unexplained (no lactate, or lactate leaves at least 4 unexplained), with a button that opens the osmolal gap fields.

### 18. Borderline compensation (Human catch 5)
> 40 year-old woman … diarrhea … pH 7.35, PCO₂ 32, HCO₃⁻ 18, AG 10 … respiratory alkalosis is the compensatory process.

- **AI error:** Winter's predicted 33–37, and a PaCO₂ of 32 was called a concomitant respiratory alkalosis.
- **Fix:** Added a 1-unit borderline zone to every compensation check, labels for edge-of-normal pH, and the case "A day of profuse diarrhea."

### 19–20. Input limits (Human catch 6)
> what is the lowest pH and the highest pH that can be read on an ABG
> ok that's fine I just wanted to make sure that no one can put in a number outside of the ranges

- **AI finding:** Only pH, PaCO₂ and HCO₃⁻ were validated; FiO₂ 150 or Na⁺ 1400 were accepted.
- **Fix:** Added accepted ranges for every field, red highlighting, "not used" messages, and unit hints (kPa, mmol/L).

### 21. Technology choice
> can we create this application using simple html, javascript, and css?

- **Result:** Confirmed it already was, with no frameworks. Split the code into `index.html`, `styles.css` and three JavaScript files.

### 22–24. Delta gap questions
> what is a normal A-a gradient?
> are we considering the delta gap?
> can't you do the delta gap by subtracting the measured anion gap from the normal anion gap, which is 12?

- **Result:** Explained A–a norms, the delta ratio, delta gap and corrected bicarbonate.

### 25. Hidden metabolic alkalosis (Human catch 7)
> pH 7.25, PaCO₂ 27, HCO₃⁻ 12, Na 140, K 4, Cl 96. Answer: anion gap metabolic acidosis with concomitant metabolic alkalosis

- **AI error:** The delta ratio of 1.67 fell in the "pure" range, so the app missed the alkalosis while showing a corrected HCO₃⁻ of 32.
- **Fix:** Added the delta gap to the decision and a key-number tile, plus the case "Gap acidosis hiding an alkalosis."

### 26. Interface question
> what is teaching mode?

- **Result:** Explained it.

### 27. Triple disorder threshold (Human catch 8)
> pH 7.15, PaCO₂ 40, HCO₃⁻ 15, Na 140, K 4, Cl 98. Answer: HAGMA, metabolic alkalosis, and respiratory acidosis

- **AI error:** The delta gap was exactly +6, and the rule required more than +6.
- **Fix:** Metabolic alkalosis is now called when the corrected HCO₃⁻ is above 28, with 26–28 borderline (and the mirror for NAGMA). Added the case "Three disorders at once."

### 28–29. Differential diagnoses
> Where can we put in diagnoses for possible acid base disorders: MUDPILES … respiratory acidosis … respiratory alkalosis
> Also add: metabolic alkalosis … metabolic acidosis … mixed disorders

- **Result:** Put Omar's lists into the `DDX` table, added differentials for secondary disorders, and created a `MIXED` table of five mixed-disorder patterns with their clinical settings.

### 30. Naming
> lets come up with a name for this app for the ABG interpreter
> i like pHinder

- **Result:** Renamed the app to pHinder.

---

## Day 2: September 30, 2026

### 31–32. Edge cases
> what is something I did not think about? what are some edge cases?
> yes fix those three

- **AI finding:** Testing showed decimal commas ("7,35") were rejected, and a COPD patient with a new gap acidosis was misread without a baseline.
- **Result:** Added co-oximetry (COHb and MetHb alerts, saturation gap, O₂ content), a venous gas mode, the patient's usual PaCO₂ and HCO₃⁻, and decimal comma support. Three new cases.

### 33–34. Ventilator context and regulation
> what would ventilator context do?
> Let's do the lean version … they need to come up with the diagnosis and how to change the vent settings themselves … without needing any FDA regulations.

- **AI research:** FDA's January 2026 revised clinical decision support guidance.
- **Result:** Added ventilator fields: minute ventilation, mL/kg of predicted body weight, breaths above the set rate, ARDS and TBI context, the post-hypercapnic pattern, and PEEP-aware Berlin grading. No setting recommendations. Removed all treatment directives from alerts and added an intended-use and sources section. Two new cases.

### 35. Barometric pressure
> Can you add in the barometric pressure?

- **Result:** Re-added it in settings; it overrides altitude.

### 36. Everest summit (Human catch 9)
> [Image: pH 7.53, PaO₂ 24.6, PaCO₂ 13.3, HCO₃ 10.8, SaO₂ 54%] … barometric pressure 272 mmHg … increased A-a gradient.

- **AI error:** The kPa rule rejected the real PaCO₂ of 13.3 as a unit error.
- **Fix:** The kPa check now tests both units with the Henderson equation. HCO₃⁻ below 12 in respiratory alkalosis is called a metabolic acidosis. At extreme altitude, an A–a gradient above 3 is flagged as increased. Added the case "Near the summit of Everest."

### 37. Files
> can you give me the html files for this

- **Result:** A single-file `phinder-standalone.html` and `phinder.zip` with separate files.

### 38. Presentation
> Your 3-Minute Gate Presentation …

- **Result:** A timed script covering the problem, demo, control moment, trustworthy AI (Map, Measure, Manage) and next steps.

### 39–42. Code walkthrough
> can you explain each file of the code step by step to me. Let's first go over the html
> lets go over each js file one by one
> how did we fix the kPa?
> [the `num`, `f` and `inRange` helper functions] What does this mean?

- **Result:** Walked through `index.html` and `abg-engine.js`, explained the kPa fix and the helper functions. Noted that `inRange` is unused.

### 43. This log
> can you create a promptlog.md file?

---

## Day 3: October 1, 2026

### 44. Henderson–Hasselbalch consistency check
> I want to use the Henderson-Hasselbech equation instead of the shortened Henderson equation. I understand that the triple disorder will show that it is inconsistent.

- **Result:** Step 1 ("Check the numbers agree") now predicts the pH with pH = 6.1 + log₁₀(HCO₃⁻ ÷ (0.03 × PaCO₂)) and compares it with the reported pH. Teaching mode shows the full calculation, including what 6.1 (pKa of carbonic acid) and 0.03 (CO₂ solubility) stand for. The kPa check uses the same equation; the Everest climber is still accepted and a typed 5.3 is still flagged. The sources section, README and code comments now name Henderson–Hasselbalch.
- **Judgment call:** Values count as consistent if the predicted pH is within 0.05 of the reported pH. A cutoff of 0.04, equivalent to the old 10% rule, flagged the triple-disorder case (pH 7.15, PaCO₂ 40, HCO₃⁻ 15), which predicts 7.20, a gap of 0.047 that is most likely rounding in the textbook values. At 0.05 it passes, while the partially compensated respiratory acidosis example (pH 7.31, PaCO₂ 49, HCO₃⁻ 30, off by 0.10) is still flagged. All 21 practice cases pass.

### 45. Exiting a practice case
> when we click on "exit case", can you clear the data automatically so that the person doesn't have to press on clear

- **Result:** "Exit case" now runs the same steps as the Clear button: every field is emptied, the case is dropped, the results return to the empty "Enter a pH, PaCO₂ and HCO₃⁻" panel, and the cursor moves to the pH box. Both buttons share one function, so they cannot drift apart.

### 46. Renaming to pHormula
> is there a better name for the app that we can come up with using pH
> let's rename this app pHormula

- **AI:** Suggested pHathom, pHocus, pHluent, pHase, pHormula and pHlag, and noted that pHinder was still a strong name.
- **Result:** Renamed the app to pHormula, after the formulas it shows at every step. Updated the page title, header, intended-use text, README and this log's title. Earlier log entries keep the name pHinder. Omar then renamed the GitHub repository to pHormula, and the local copy was pointed at the new address. The local folder is still named pHinder.
