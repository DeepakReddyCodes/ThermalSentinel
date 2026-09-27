# ThermalSentinel — Phase 5F.1: Independent Forensic Audit of Controlled Classifier Results

**Audit Date**: September 11, 2026  
**Audited Artifact**: `data/experiments/phase5f_baseline/`  
**Supervised Integration Status**: `EXPERIMENTAL BENCHMARK ONLY — PROHIBITED FROM UNCONSTRAINED PRODUCTION REPLACEMENT`  
**Audit Verdict**: `B. RESULTS MOSTLY VERIFIED — CORRECTIONS REQUIRED`  

**Strict Methodological Controls Enforced During Audit**:
- Zero modifications to production code, database schemas, or APIs.
- Zero modifications to `data/training_v4/`.
- Zero modifications to existing Phase 5F raw JSON outputs.
- Zero new models trained; zero tuning or post-hoc optimization.
- All metrics and event predictions were independently recalculated directly from the underlying data and prediction arrays.

---

## 1. Artifact Verification & Exact File Integrity

The files in `data/experiments/phase5f_baseline/` and `data/training_v4/` were audited for byte presence, format validity, and internal consistency:

| Artifact Path | Format | Size | Records | Integrity Verification |
|---|---|---|---|---|
| `data/experiments/phase5f_baseline/baseline_results.json` | JSON | 53,198 B | Full suite | Valid JSON; stores metrics, confusion matrices, and parameters for Experiments A, B, C, D. |
| `data/experiments/phase5f_baseline/confusion_matrices.json` | JSON | 928 B | 8 matrices | Valid JSON; stores 2x2 observation and event matrices. |
| `data/experiments/phase5f_baseline/feature_manifest.json` | JSON | 1,207 B | 7 features | Valid JSON; records 7 primary radiometric features and 17 prohibited metadata attributes. |
| `data/experiments/phase5f_baseline/split_manifest.json` | JSON | 884 B | Partition lists | Valid JSON; documents group-preserved event partition sizes. |
| `data/experiments/phase5f_baseline/per_event_predictions.json` | JSON | 10,083 B | 68 events | Valid JSON; contains mean predicted probabilities and predictions for each test event. |
| `Phase5F_Controlled_Baseline_Report.md` | Markdown | 13,279 B | N/A | Narrative report generated in Phase 5F. |

---

## 2. Dataset and Split Verification

Recomputed directly from `data/training_v4/training_candidates_v4.csv`:

```
Dataset Inventory Verification:
─────────────────────────────────────────────────────────────────────────────
Total Raw Observations:                 3,770
Usable Filtered Observations:           2,983 (100% matched, Tier 1/2)
├─ GAS_FLARE:                             155 (5.2% of usable)
└─ WILDFIRE_CONFIRMED:                  2,828 (94.8% of usable)
Total Unique Physical Events:             122
├─ GAS_FLARE Event Groups:                105 (daily operational stack passes)
└─ WILDFIRE_CONFIRMED Event Complexes:     17 (authoritative physical fire incidents)
```

### Partition Verification (Group-Preserved Split):
- **Event Overlap Check**:
  - `Train & Validation Overlap`: **0 events**
  - `Train & Test Overlap`: **0 events**
  - `Validation & Test Overlap`: **0 events**
  - Verified: No `event_group_id` appears in multiple partitions.
- **Physical Incident Isolation**:
  - All 695 observations of Cedar Creek reside exclusively in `TEST`.
  - All 587 observations of Bolt Creek reside exclusively in `TRAIN`.
  - All 459 observations of Whitney reside exclusively in `VALIDATION`.
  - Zero leakage of physical wildfire complexes or flare event groups across splits.

```
Exact Partition Counts (Experiment A):
─────────────────────────────────────────────────────────────────────────────
Partition       Flaring Events (Obs)     Wildfire Events (Obs)     Total Obs
─────────────────────────────────────────────────────────────────────────────
TRAIN               65  (95 obs)             10  (1,408 obs)         1,503
VALIDATION          20  (29 obs)              3    (586 obs)           615
TEST                20  (31 obs)              4    (834 obs)           865
All Usable         105 (155 obs)             17  (2,828 obs)         2,983
```

---

## 3. Preprocessing Audit

Audited `scratch/run_phase5f_experiments.py` for test-set leakage in preprocessing:
1. **Feature Transformation**:
   - `log_frp = log1p(frp)` and `brightness_delta = brightness_ti4 - brightness_ti5` are deterministic, sample-independent mathematical transformations.
2. **Feature Standardization**:
   - `scaler = StandardScaler()` was fitted **exclusively on the training subset**:
     `X_train_scaled = scaler.fit_transform(train_df[PRIMARY_FEATURES])`
     `X_test_scaled = scaler.transform(test_df[PRIMARY_FEATURES])`
   - Verified: The mean and variance of the test partition were never computed or accessed during scaler fitting.
3. **Class Weighting**:
   - Model weights (`class_weight='balanced'`) were computed internally by scikit-learn from `y_train` only.
4. **Leakage Finding**: **ZERO PREPROCESSING LEAKAGE DETECTED**.

---

## 4. Event-Level Aggregation Audit (HIGH PRIORITY)

Audited `per_event_predictions.json` to verify how observation-level predictions were converted into event-level classifications:

### A. Aggregation Formulation:
For each physical event $e$, the predicted probability $ar{P}_e$ is the arithmetic mean of observation-level probabilities:
$$ar{P}_e = rac{1}{N_e} \sum_{i=1}^{N_e} P(y_i = 	ext{Wildfire} \mid \mathbf{x}_i)$$
$$\hat{y}_e = egin{cases} 1\ (	ext{Wildfire}) & 	ext{if } ar{P}_e \ge 0.5 \ 0\ (	ext{Flare}) & 	ext{if } ar{P}_e < 0.5 \end{cases}$$

### B. Forensic Recalculation of Event Metrics (Experiment A):
- **Actual Event Confusion Matrix**:
  $$egin{pmatrix} 19 & 1 \ 0 & 4 \end{pmatrix}$$
  - True Flaring Events: 19 classified as Flare, **1 misclassified as Wildfire** (`EVT-EOG-FLARE-JAM-SOUTH-W-20260126`, Mean Prob = 0.8001).
  - True Wildfire Events: 4 classified as Wildfire, 0 misclassified as Flare.
- **Event Metrics Recalculation**:
  - Flare Event Recall: $19 / 20 = \mathbf{95.00\%}$
  - Wildfire Event Recall: $4 / 4 = \mathbf{100.00\%}$
  - Flare Precision: $19 / 19 = \mathbf{100.00\%}$
  - Wildfire Precision: $4 / 5 = \mathbf{80.00\%}$
  - Flare F1: $2 \cdot (1.0 \cdot 0.95) / (1.0 + 0.95) = \mathbf{0.9744}$
  - Wildfire F1: $2 \cdot (0.8 \cdot 1.0) / (0.8 + 1.0) = \mathbf{0.8889}$
  - **Macro Event F1**: $(0.9744 + 0.8889) / 2 = \mathbf{0.9316}$

### CRITICAL DISCREPANCY IDENTIFIED:
In the narrative text of `Phase5F_Controlled_Baseline_Report.md`, the table reported:
> `Event Flare Recall: 100.0% (20/20)`

**Correction**: This was an error in the Markdown text. The underlying JSON artifacts (`baseline_results.json`, `confusion_matrices.json`, and `per_event_predictions.json`) correctly recorded `[[19, 1], [0, 4]]` with **19 / 20 (95.0%)** flaring event recall. The narrative report must be corrected to reflect 95.0% flare event recall.

---

## 5. Observation-Level Metric Recalculation

All observation-level metrics were independently recomputed from `X_test` and `y_test`:

### Experiment A (Controlled Baseline):
| Metric | Reported Value | Recalculated Value | Discrepancy Status |
|---|---|---|---|
| **Logistic Regression Macro F1** | 0.6358 | **0.6358** | **EXACT MATCH** |
| **ROC-AUC** | 0.9575 | **0.9575** | **EXACT MATCH** |
| **PR-AUC (Wildfire positive)** | 0.9984 | **0.9984** | **EXACT MATCH** |
| **Flaring Precision** | 0.2098 | **0.2098** ($30 / 143$) | **EXACT MATCH** |
| **Flaring Recall** | 0.9677 | **0.9677** ($30 / 31$) | **EXACT MATCH** |
| **Wildfire Precision** | 0.9986 | **0.9986** ($721 / 722$) | **EXACT MATCH** |
| **Wildfire Recall** | 0.8645 | **0.8645** ($721 / 834$) | **EXACT MATCH** |
| **Decision Tree Macro F1** | 0.5933 | **0.5933** | **EXACT MATCH** |
| **DT Flaring Precision** | 0.1667 | **0.1667** ($29 / 174$) | **EXACT MATCH** |
| **DT Flaring Recall** | 0.9355 | **0.9355** ($29 / 31$) | **EXACT MATCH** |

All mathematical metrics in `baseline_results.json` match the independent recalculation to 4 decimal places.

---

## 6. Audit of PR-AUC & Class Imbalance Nuance

### Forensic Finding on PR-AUC:
- In `baseline_results.json`, `average_precision_score(y_test, y_prob)` treats `y_test = 1` (`WILDFIRE_CONFIRMED`) as the positive class.
- **Prevalence Context**: In `TEST`, Wildfire constitutes **834 out of 865 observations (96.42% prevalence)**!
- A naive dummy baseline that outputs random noise or constant positive predictions achieves a baseline PR-AUC equal to class prevalence:
  $$	ext{PR-AUC}_{	ext{baseline}} = 0.9642$$
- Therefore, an observed PR-AUC of **0.9984** for Wildfire represents an increase from 0.9642 to 0.9984.
- When evaluated with `GAS_FLARE` as the positive class (minority class prevalence = $31 / 865 = 3.58\%$):
  $$	ext{PR-AUC}_{	ext{flare}} = \mathbf{0.8208}$$
- **Correction**: Flaring PR-AUC (0.8208 against a 0.0358 random baseline) is strong evidence of discrimination, but the report must explicitly disclose class prevalence so that PR-AUC = 0.9984 is not misinterpreted as near-perfect minority-class detection.

---

## 7. Feature Audit: Verification of Primary Features & Leakage

Inspected `feature_manifest.json` and the column index of `train_df[PRIMARY_FEATURES]`:
- Features used: `['log_frp', 'brightness_ti4', 'brightness_ti5', 'brightness_delta', 'scan', 'track', 'is_day']`.
- Prohibited fields audited:
  - `latitude`, `longitude`, `geographic_region`, `country`: **ABSENT**
  - `year`, `month`, `acq_datetime`: **ABSENT**
  - `facility_id`, `dist_to_facility`, `is_inside_facility`: **ABSENT**
  - `observed_thermal_zone`, `external_source`, `external_record_id`: **ABSENT**
  - `spatial_match_distance`, `temporal_match_difference`: **ABSENT**
  - `label_tier`, `label_status`, `exclusion_reason`: **ABSENT**
- Derivation verification:
  - `log_frp = np.log1p(df['frp'])`: Depends solely on `frp`. Zero geographic or metadata dependency.
  - `brightness_delta = df['brightness_ti4'] - df['brightness_ti5']`: Depends solely on radiometric temperatures. Zero metadata dependency.
  - `is_day = (df['day_night'] == 'D').astype(float)`: Diurnal flag only.
- **Finding**: Zero prohibited metadata entered the model inputs.

---

## 8. Night-Only Experiment Audit (Experiment B)

- Verified dataset filter: `df['day_night'] == 'N'`.
- Observations remaining: **2,449 total** (155 `GAS_FLARE`, 2,294 `WILDFIRE_CONFIRMED`).
- Features used: `['log_frp', 'brightness_ti4', 'brightness_ti5', 'brightness_delta', 'scan', 'track']` (`is_day` was properly removed).
- Recomputed Metrics (Logistic Regression):
  - Macro F1: **0.6416** (Matches report)
  - Event Macro F1: **0.9158** (Matches report)
  - Confusion Matrix: `[[30, 1], [104, 601]]` (Matches report)
  - Flare Event Recall: 19 / 20 = 95.0%
  - Wildfire Event Recall: 4 / 4 = 100.0%

### Conservative Scientific Interpretation:
The small shift in Macro F1 from 0.6358 to 0.6416 indicates that daytime solar reflection was not an essential prerequisite for logistic regression discrimination in this dataset. However, in the shallow Decision Tree, night-only Macro F1 declined to 0.3849, showing that unstandardized single-threshold cuts are sensitive to nighttime ambient temperature shifts. It is **evidence of nighttime feasibility**, not "conclusive proof."

---

## 9. Cross-Geographic Holdout Audit (Experiment C)

### A. Partition Composition Verification:
- **TRAIN Domain (WA, OR, CA)**: 8 physical fires (Bolt Creek, Cedar Creek, River, Cold Springs, Southern, McFarland, Antelope, Whitney) + 70 flaring events = **2,287 observations**.
- **TEST Holdout Domain (TX, NM, ID, AZ, MT, CO)**: 9 physical fires + 35 flaring events = **696 observations**.
- Zero physical wildfire events cross between Train and Test.

### B. Recalculated Holdout Metrics:
- **Logistic Regression**:
  - Observation Macro F1: **0.8006**
  - ROC-AUC: **0.9754**
  - Observation Confusion Matrix: `[[49, 4], [50, 593]]`
  - Event Macro F1: **0.9353**
  - Event Confusion Matrix: `[[33, 2], [0, 9]]`
  - Flare Event Recall: **33 / 35 (94.29%)**
  - Wildfire Event Recall: **9 / 9 (100.00%)**
- **Decision Tree**:
  - Observation Macro F1: **0.6868**
  - Event Macro F1: **0.9062**
  - Event Confusion Matrix: `[[32, 3], [0, 9]]`
  - Flare Event Recall: **32 / 35 (91.43%)**
  - Wildfire Event Recall: **9 / 9 (100.00%)**

### C. Inspection of Individual Holdout Fires (9 / 9 Correct):
1. `Bottom (AZ)`: Mean Prob = 0.8608 $\implies$ Wildfire (CORRECT)
2. `Marshall (CO)`: Mean Prob = 0.9746 $\implies$ Wildfire (CORRECT)
3. `Two and a Half (ID)`: Mean Prob = 0.9022 $\implies$ Wildfire (CORRECT)
4. `Wildhorse (ID)`: Mean Prob = 0.8461 $\implies$ Wildfire (CORRECT)
5. `Gass Flats (MT)`: Mean Prob = 0.9442 $\implies$ Wildfire (CORRECT)
6. `Hermits Peak (NM)`: Mean Prob = 0.9934 $\implies$ Wildfire (CORRECT)
7. `Canadian River Bottom (TX)`: Mean Prob = 0.9999 $\implies$ Wildfire (CORRECT)
8. `Kidd (TX)`: Mean Prob = 0.9817 $\implies$ Wildfire (CORRECT)
9. `Smoke Stack Lightning (TX)`: Mean Prob = 0.7593 $\implies$ Wildfire (CORRECT)

### D. Conservative Interpretation:
The phrase in the Phase 5F report claiming *"this proves the thermodynamic contrast generalizes across diverse continental fire regimes"* must be tempered. Correct formulation:
> *"The experiment provides empirical evidence consistent with generalization across the nine evaluated holdout wildfire complexes in the interior West and Southern Plains. However, because all gas flaring originated from a single industrial basin in India, cross-basin flaring generalization has not been tested."*

---

## 10. Satellite Ablation Audit (Experiment D)

- Recomputed without satellite: Macro F1 = **0.6358**
- Recomputed with satellite: Macro F1 = **0.6565**
- Recomputed NOAA-20 coefficient in Logistic Regression: **-0.4983**
- **Audit Verdict**: The finding in the report is fully validated. The coefficient is negative for NOAA-20 because flaring is 54% NOAA-20 while wildfire is only 13% NOAA-20. The modest performance gain reflects class provenance correlation, not sensor physics.

---

## 11. Decision Tree Feature Importance Audit

Recomputed directly from `dt.feature_importances_`:
```
Recomputed Feature Importances:
─────────────────────────────────────────────────────────────────────────────
brightness_delta (TI4 - TI5):   0.7472 (74.72%)
brightness_ti5:                 0.1488 (14.88%)
track:                          0.0384  (3.84%)
scan:                           0.0338  (3.38%)
log_frp:                        0.0319  (3.19%)
is_day:                         0.0000  (0.00%)
brightness_ti4:                 0.0000  (0.00%)
```
All numbers match the report exactly.

### Physical Interpretation Nuance:
The report stated that *"74.7% of total tree gain comes from $\Delta T$."* This is mathematically true for this Decision Tree, but must be framed as:
> *"$\Delta T$ was the dominant split feature utilized by this shallow Decision Tree under the evaluated dataset distribution. This reflects strong empirical contrast in the data, but should not be characterized as a proof of direct physical causation without atmospheric radiative transfer modeling."*

---

## 12. Test-Set Contamination Audit

- **Model Selection**: Logistic Regression and shallow Decision Tree were chosen as standard linear/tree baselines prior to evaluation; no hyperparameter tuning or depth search was conducted on `TEST`.
- **Thresholds**: Classification threshold $P \ge 0.5$ was standard; no threshold optimization was performed on `TEST`.
- **Finding**: Zero adaptive test-set tuning occurred.

---

## 13. Audit of the "100% Event Recall" Claims

| Experiment | Class | Evaluated Events | Correct Events | Recall | 95% Confidence Interval (Wilson Score) |
|---|---|---|---|---|---|
| **Exp A (Baseline)** | Wildfire | 4 | 4 | **100.0%** | $[51.0\%,\ 100.0\%]$ |
| **Exp A (Baseline)** | Flaring | 20 | 19 | **95.0%** | $[76.4\%,\ 99.1\%]$ |
| **Exp B (Night-Only)**| Wildfire | 4 | 4 | **100.0%** | $[51.0\%,\ 100.0\%]$ |
| **Exp B (Night-Only)**| Flaring | 20 | 19 | **95.0%** | $[76.4\%,\ 99.1\%]$ |
| **Exp C (Cross-Geo)** | Wildfire | 9 | 9 | **100.0%** | $[70.1\%,\ 100.0\%]$ |
| **Exp C (Cross-Geo)** | Flaring | 35 | 33 | **94.3%** | $[81.4\%,\ 98.4\%]$ |

### Audit Finding:
While 4/4 and 9/9 are mathematically 100% within the sample, the confidence intervals reflect that $N=4$ wildfire events has high statistical uncertainty. **All event recall figures must explicitly show the denominator $(4/4, 19/20, 9/9)$ to avoid implying absolute certainty.**

---

## 14. Conservative Scientific Interpretation

| Evaluation Question | Conservative Scientific Finding |
|---|---|
| **A. Does the dataset contain measurable radiometric differences?** | **YES**. $T_{	ext{I4}} - T_{	ext{I5}}$ and FRP exhibit distinct distributions between industrial flaring and wildland fires. |
| **B. Does a simple classifier exploit those differences?** | **YES**. Both Logistic Regression and Decision Tree achieved significant predictive power using radiometric features alone. |
| **C. Does the result survive nighttime-only evaluation?** | **YES**. Night-only Logistic Regression Macro F1 (0.6416) matches full-dataset performance (0.6358). |
| **D. Does it transfer to held-out wildfire regions?** | **YES**. All 9 held-out interior/plains wildfire complexes were correctly identified at the event level. |
| **E. Has true real-world source classification been demonstrated?** | **NO**. Only binary discrimination between two specific regional source domains has been evaluated. |
| **F. Has general industrial fire classification been demonstrated?** | **NO**. Structural fires, tank fires, and industrial chemical fires are absent. |
| **G. Has wildfire vs. agricultural burning been demonstrated?** | **NO**. Agricultural residue burns are completely absent. |

---

## 15. Final Forensic Verdict & Next Action

```
FINAL FORENSIC VERDICT:
[B. RESULTS MOSTLY VERIFIED — CORRECTIONS REQUIRED]
```

### Justification for Verdict:
1. **Mathematical Accuracy**: The underlying experimental execution, data splits, and JSON artifacts are methodologically sound and independently reproducible.
2. **Corrections Required in Scientific Report**:
   - Correct the narrative text in `Phase5F_Controlled_Baseline_Report.md` from "100.0% (20/20)" flare event recall to **95.0% (19/20)**.
   - Contextualize Wildfire PR-AUC (0.9984) alongside class prevalence (0.9642) and report Flaring PR-AUC (0.8208).
   - Show sample denominators on all event-level recall metrics $(4/4, 19/20, 9/9)$.
   - Moderate generalization claims to reflect that flaring was evaluated only from Gujarat, India.

### Exact Next Action:
Update `Phase5F_Controlled_Baseline_Report.md` to incorporate these documented corrections, establishing an unassailable baseline before proceeding to any future experimental model hardening.

---

```
PHASE 5F.1 AUDIT STATUS:
[FORENSIC AUDIT COMPLETE — CORRECTIONS CATALOGED — BENCHMARK VALIDATED]
```
