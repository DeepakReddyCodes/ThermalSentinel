# ThermalSentinel — Phase 5F Controlled XGBoost Experiment & Model Comparison Report

**Phase:** Phase 5F Controlled XGBoost Challenger Evaluation  
**Date:** 2026-09-11  
**Status:** COMPLETE — DECISION: `RETAIN_AS_EXPERIMENTAL`  
**Dataset:** `data/training_v4/training_candidates_v4.csv` (ThermalSentinel-Training-Candidates-v4-Diverse)  
**Target:** `GAS_FLARE` (0) vs `WILDFIRE_CONFIRMED` (1)  
**Models Evaluated:**
1. Standardized L2 Logistic Regression (`lr-v5f3-standardized` — Operational Model)
2. Decision Tree (`max_depth=3`, `class_weight='balanced'`)
3. Random Forest (`n_estimators=100`, `max_depth=4`, `class_weight='balanced'`)
4. XGBoost Classifier (`max_depth=3`, `learning_rate=0.05`, `n_estimators=100`, `reg_alpha=0.1`, `reg_lambda=1.0`)

---

## 1. Experimental Integrity & Data Discipline

### Frozen Dataset & Split
- **Total Eligible Records:** 2,983 observations (155 Gas Flare across 105 physical event groups, 2,828 Wildfire across 17 physical event groups).
- **Partitioning Policy:** Strict Group-Preserved Event Partitioning with Zero Event Overlap.
  - **TRAIN Partition:** 1,503 observations across 75 physical event groups (65 flare groups, 10 wildfire groups).
  - **VALIDATION Partition:** 615 observations across 23 physical event groups (20 flare groups, 3 wildfire groups).
  - **TEST Partition:** 865 observations across 24 physical event groups (20 flare groups, 4 wildfire groups).

### Operational Feature Set
Strictly restricted to the 7 audited operational features:
1. `log_frp`: Natural logarithm $\ln(1 + \text{FRP})$
2. `brightness_ti4`: VIIRS 3.74 µm MWIR brightness temperature (K)
3. `brightness_ti5`: VIIRS 11.45 µm LWIR brightness temperature (K)
4. `brightness_delta`: Spectral radiance difference ($TI4 - TI5$)
5. `scan`: Cross-track pixel footprint dimension (km)
6. `track`: Along-track pixel footprint dimension (km)
7. `is_day`: Diurnal observation indicator (1 = Day, 0 = Night)

**Prohibited Features Audit:** Zero geographic coordinates (`latitude`, `longitude`), administrative units (`country`, `state`), incident names, event IDs, timestamps, facility identifiers, or external telemetry were introduced.

### Class Imbalance Handling
Sample weights were computed strictly from the **TRAINING** partition:
- Flare (minority, $N=95$): weight = `7.9105`
- Wildfire (majority, $N=1408$): weight = `0.5337`
- Test set class frequencies were not used in any training or tuning step.

---

## 2. Primary Controlled Test Partition Comparison

All models were evaluated on the **EXACT SAME TEST SET** ($N=865$ observations: 31 flare, 834 wildfire; 24 physical events: 20 flare, 4 wildfire).

### Observation-Level Performance Matrix

| Metric | Logistic Regression | Decision Tree (d3) | Random Forest (d4) | XGBoost (Controlled) |
| :--- | :---: | :---: | :---: | :---: |
| **Accuracy** | 86.82% | 80.69% | 83.12% | **87.98%** |
| **Macro F1** | 0.6358 | 0.5933 | 0.6050 | **0.6419** |
| **ROC-AUC** | 0.9658 | 0.9388 | 0.9700 | **0.9702** |
| **Flare PR-AUC** (prev = 0.0358) | **0.4584** | 0.3801 | 0.4070 | 0.4503 |
| **Wildfire PR-AUC** (prev = 0.9642) | 0.9987 | 0.9972 | 0.9987 | **0.9988** |
| **Flare Precision** | 0.2098 | 0.1554 | 0.1706 | **0.2171** |
| **Flare Recall** | **0.9677** (30/31) | 0.9677 (30/31) | 0.9355 (29/31) | 0.9032 (28/31) |
| **Flare F1** | 0.3448 | 0.2679 | 0.2886 | **0.3500** |
| **Wildfire Precision** | 0.9986 | 0.9985 | 0.9972 | 0.9959 |
| **Wildfire Recall** | 0.8645 (721/834) | 0.8010 (668/834) | 0.8273 (690/834) | **0.8789** (733/834) |
| **Wildfire F1** | 0.9267 | 0.8889 | 0.9049 | **0.9338** |

### Event-Level Performance Matrix (Operational Aggregation Rule: Mean Probability, Threshold = 0.5)

| Metric | Logistic Regression | Decision Tree (d3) | Random Forest (d4) | XGBoost (Controlled) |
| :--- | :---: | :---: | :---: | :---: |
| **Event Macro F1** | **0.9316** | **0.9316** | **0.9316** | **0.9316** |
| **Flare Event Recall** | **19/20** (95.0%) | **19/20** (95.0%) | **19/20** (95.0%) | **19/20** (95.0%) |
| **Wildfire Event Recall** | **4/4** (100.0%) | **4/4** (100.0%) | **4/4** (100.0%) | **4/4** (100.0%) |
| **Flare Event Precision** | 1.0000 (19/19) | 1.0000 (19/19) | 1.0000 (19/19) | 1.0000 (19/19) |
| **Wildfire Event Precision**| 0.8000 (4/5) | 0.8000 (4/5) | 0.8000 (4/5) | 0.8000 (4/5) |

### Observation-Level Confusion Matrices

```
Logistic Regression:
                Predicted Flare    Predicted Wildfire
Actual Flare          30                   1
Actual Wildfire      113                 721

XGBoost Classifier:
                Predicted Flare    Predicted Wildfire
Actual Flare          28                   3
Actual Wildfire      101                 733
```

### Event-Level Confusion Matrices
```
ALL FOUR MODELS (Logistic Regression, Decision Tree, Random Forest, XGBoost):
                Predicted Flare Evt    Predicted Wildfire Evt
Actual Flare            19                      1
Actual Wildfire          0                      4
```

**Key Forensic Finding on Event Disambiguation:**
All four classifiers fail on the exact same single flaring event:
- Event: `EVT-EOG-FLARE-JAM-SOUTH-E-20260124`
  - Observation count: 1
  - Mean predicted wildfire probability: LR = `0.925`, XGB = `0.944`, DT = `0.982`
  - Cause: High anomalous daytime saturation resembling an uncontained brush fire.
All four models achieve identical **100% recall (4/4)** on test wildfire events (`Cedar Creek`, `Marshall`, `Wildhorse`, `Cold Springs`).

---

## 3. Feature Importance & Ranking Analysis

| Feature | LR Coef (Std) | DT Imp | RF Imp | XGB Gain (Norm) | XGB Val Perm Imp |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `brightness_delta` ($TI4 - TI5$) | **+4.4216** | **0.7472** | **0.3735** | **0.4428** | **0.3825** |
| `brightness_ti5` | -2.5229 | 0.1488 | 0.1746 | 0.1577 | 0.1771 |
| `brightness_ti4` | +2.1678 | 0.0000 | 0.2522 | 0.1564 | 0.0124 |
| `log_frp` | +0.5429 | 0.0319 | 0.1111 | 0.0695 | 0.0604 |
| `scan` | -0.0298 | 0.0338 | 0.0490 | 0.0931 | 0.0066 |
| `track` | +0.5018 | 0.0384 | 0.0240 | 0.0805 | 0.0882 |
| `is_day` | +4.3430 | 0.0000 | 0.0156 | 0.0000 | 0.0000 |

### Physical Interpretation
1. **Dominance of `brightness_delta`:**
   In physical combustion radiative transfer, small sub-pixel high-temperature sources (such as gas flares, typically 1600–2000 K) produce enormous radiance spikes in the 3.74 µm MWIR channel ($TI4$) while barely elevating the 11.45 µm LWIR channel ($TI5$). Consequently, $TI4 - TI5$ is the primary thermodynamic discriminator. Both linear and tree-based architectures independently isolate this feature as the most important signal.
2. **Behavior of `is_day`:**
   Logistic Regression assigned high positive weight to `is_day` due to linear colinearity with ambient solar heating. In contrast, XGBoost, Decision Trees, and Random Forests assign near-zero importance to `is_day`, establishing their nonlinear splits directly on `brightness_delta` and $TI5$.

---

## 4. Cross-Geographic Holdout Evaluation (Experiment C)

To evaluate sensitivity to spatial transfer across distinct biomes, models were trained on Pacific Northwest/California wildfires (WA, OR, CA — 8 fires) and evaluated on a holdout domain of Southern Plains, Desert Southwest, and Rocky Mountain wildfires (TX, NM, ID, AZ, MT, CO — 9 fires).

| Model | Cross-Geo Obs Macro F1 | Cross-Geo Evt Macro F1 | Flare Evt Recall | Wildfire Evt Recall |
| :--- | :---: | :---: | :---: | :---: |
| **Logistic Regression** | 0.8006 | **0.9353** | **33/35** (94.3%) | **9/9** (100.0%) |
| **Decision Tree (d3)** | 0.6868 | 0.9062 | 32/35 (91.4%) | **9/9** (100.0%) |
| **XGBoost (Controlled)** | **0.9012** | **0.9353** | **33/35** (94.3%) | **9/9** (100.0%) |

**Finding:**
On the holdout partition, XGBoost achieves higher observation-level Macro F1 (`0.9012` vs LR `0.8006`), but at the event level, both Logistic Regression and XGBoost yield **identical operational event discrimination: 33/35 Flare events, 9/9 Wildfire events (Event Macro F1 = 0.9353)**.

---

## 5. Leakage & Domain Confounding Audit

1. **Cedar Creek Concentration Audit:**
   - In the primary test partition, the Cedar Creek Fire accounts for **695 of 834 (83.3%)** of all wildfire observations.
   - High observation accuracy primarily reflects repetitive sub-pixel detections across multiple satellite overpasses over a single Oregon wildfire.
   - Therefore, observation-level metrics alone cannot substantiate claims of universal physical discrimination.
2. **Event Disjointness:** Zero event groups overlap between train, validation, and test partitions.
3. **Training Provenance:** No live unverified FIRMS observations were added to training data.

---

## 6. Formal Model Decision

### Classification: `RETAIN_AS_EXPERIMENTAL`

### Rationale:
1. **Zero Event-Level Discriminative Gain:** In both the primary controlled test partition (`19/20` flare, `4/4` wildfire) and the cross-geographic holdout (`33/35` flare, `9/9` wildfire), XGBoost produces **identical event-level predictions** to the existing frozen Logistic Regression model.
2. **Interpretability & Forensic Verification:** Logistic Regression provides a transparent, auditable linear equation with 7 coefficients that can be verified in a single arithmetic expression. In contrast, XGBoost comprises an ensemble of 100 decision trees, making manual inspection by field investigators significantly more difficult.
3. **Dataset Scale & Over-Parameterized Risk:** With 105 flaring groups and 17 wildfire events, the limiting factor is sample diversity, not classifier capacity. An ensemble model introduces complexity without delivering operational triage improvements.
4. **Architecture Stability:** The deployed ThermalSentinel application already embeds the audited `lr-v5f3-standardized` parameters with verified end-to-end integration.

**Recommendation:** Maintain `lr-v5f3-standardized` as the operational advisory model in production. Retain `xgboost_phase5f_controlled.json` in `data/experiments/phase5f_xgboost/` as an offline challenger benchmark.
