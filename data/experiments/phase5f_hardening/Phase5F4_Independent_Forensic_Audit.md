# ThermalSentinel — Phase 5F.4: Independent Forensic Audit of Model Hardening

**Document Type**: Independent Forensic Audit Report  
**Phase**: Phase 5F.4 — Independent Forensic Audit of Model Hardening  
**Audit Target**: Phase 5F.3 Controlled Model Hardening Experiments & Artifacts  
**Audit Verdict**: `A. HARDENING VERIFIED — PROCEED TO INTEGRATION DESIGN`  
**Operational Status**: `STRICTLY EXPERIMENTAL ADVISORY COMPONENT (NOT PRODUCTION READY)`  

---

## Executive Summary

An exhaustive, independent forensic audit of the Phase 5F.3 controlled model hardening experiments was conducted. The audit inspected all underlying datasets, split definitions, preprocessing pipelines, model configurations, serialized JSON outputs, per-event predictions, and the narrative report [`Phase5F3_Controlled_Model_Hardening_Report.md`](file:///C:/Users/deepa/antigravity/ThermalSentinel/Phase5F3_Controlled_Model_Hardening_Report.md).

All quantitative metrics and confusion matrices reported in Phase 5F.3 were independently recalculated directly from the raw telemetry and prediction dictionaries using a standalone verification script ([`scratch/run_phase5f4_audit.py`](file:///C:/Users/deepa/.gemini/antigravity/brain/855723df-c351-46cc-82f6-8898cfa1c53f/scratch/run_phase5f4_audit.py)).

### Forensic Audit Conclusions:
1. **Mathematical Reproducibility (100% PASS)**: Every observation-level and event-level metric, PR-AUC value, and confusion matrix cell matches the reported values with zero discrepancies across all 5 ablations and the cross-geographic holdout.
2. **Partition Integrity & Zero Leakage (PASS)**: Zero event groups overlap between TRAIN, VALIDATION, and TEST. Zero prohibited geographic, temporal, or facility metadata entered the models directly or indirectly.
3. **Preprocessing Isolation (PASS)**: `StandardScaler` was fitted strictly on the TRAIN partition; validation and test partitions were transformed using training-derived parameters.
4. **Model Configuration Compliance (PASS)**: Logistic Regression, Shallow Decision Tree ($d=3$), and Shallow Random Forest ($d=4$, $n=100$) were executed with frozen parameters predefined prior to test evaluation. Random Forest was explicitly authorized and pre-specified in `Phase5F2_Model_Hardening_Spec.md` Section 3.
5. **No Evidence of Post-Hoc Test Adaptation (PASS)**: No features were pruned, no hyperparameter sweeps were run, and no decision thresholds were adjusted based on test set inspection.
6. **Scientific Claim Corrections Enforced**: The audit identified 6 narrative overclaims in the Phase 5F.3 report where statistical correlation was described in causal or overly broad terms (e.g. "proving lack of solar reliance", "governed by", "validates universal generalization"). Formal corrective language is established in Section 15 of this audit report.

---

## 1. Audit Artifact Inventory & Integrity Check

The audit inspected and verified the following artifacts in [`data/experiments/phase5f_hardening/`](file:///C:/Users/deepa/antigravity/ThermalSentinel/data/experiments/phase5f_hardening/):

| Artifact File | Size (Bytes) | Hash / Integrity Status | Content Verified |
| :--- | :---: | :---: | :--- |
| [`hardening_manifest.json`](file:///C:/Users/deepa/antigravity/ThermalSentinel/data/experiments/phase5f_hardening/hardening_manifest.json) | 3,255 | PASS | Recorded feature policies, splits, seeds, and configurations. |
| [`hardening_results.json`](file:///C:/Users/deepa/antigravity/ThermalSentinel/data/experiments/phase5f_hardening/hardening_results.json) | 1,458,860 | PASS | Complete metrics, validation, test, ablations A–E, cross-geo. |
| [`hardening_confusion_matrices.json`](file:///C:/Users/deepa/antigravity/ThermalSentinel/data/experiments/phase5f_hardening/hardening_confusion_matrices.json) | 2,274 | PASS | All 2x2 observation and event confusion matrices. |
| [`hardening_feature_importance.json`](file:///C:/Users/deepa/antigravity/ThermalSentinel/data/experiments/phase5f_hardening/hardening_feature_importance.json) | 1,864 | PASS | Tree Gini split gains and LR standardized coefficients. |
| [`hardening_per_event_predictions.json`](file:///C:/Users/deepa/antigravity/ThermalSentinel/data/experiments/phase5f_hardening/hardening_per_event_predictions.json) | 37,965 | PASS | Per-event probabilities, counts, and predictions for test partitions. |
| [`Phase5F3_Controlled_Model_Hardening_Report.md`](file:///C:/Users/deepa/antigravity/ThermalSentinel/data/experiments/phase5f_hardening/Phase5F3_Controlled_Model_Hardening_Report.md) | 34,853 | PASS | Canonical Markdown narrative hardening report. |

Execution scripts in [`scratch/`](file:///C:/Users/deepa/.gemini/antigravity/brain/855723df-c351-46cc-82f6-8898cfa1c53f/scratch/) were audited to confirm deterministic execution with `random_state=42`.

---

## 2. Dataset and Partition Disjointness Audit

### A. Instance and Class Counts:
- **Raw CSV Records**: 3,770 rows in `data/training_v4/training_candidates_v4.csv`.
- **Eligible Supervised Records**: **2,983** rows strictly filtered by `label_status == 'MATCHED'`, `label_tier in ['TIER_1', 'TIER_2']`, and `label in ['GAS_FLARE', 'WILDFIRE_CONFIRMED']`.
- **Class Breakdown**:
  - `GAS_FLARE`: **155** observations ($5.20\%$) across **105** daily event groups.
  - `WILDFIRE_CONFIRMED`: **2,828** observations ($94.80\%$) across **17** incident complexes.
  - Total Physical Events: **122**.

### B. Split Reconstruction and Disjointness Audit:
The exact event partition was recomputed and verified:

| Partition | Flaring Events | Flaring Obs | Wildfire Events | Wildfire Obs | Total Events | Total Obs | Flaring Obs Prev | Wildfire Obs Prev |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **TRAIN** | 65 | 95 | 10 | 1,408 | 75 | 1,503 | 6.32% | 93.68% |
| **VALIDATION** | 20 | 29 | 3 | 586 | 23 | 615 | 4.72% | 95.28% |
| **TEST** | 20 | 31 | 4 | 834 | 24 | 865 | 3.58% | 96.42% |
| **Total** | **105** | **155** | **17** | **2,828** | **122** | **2,983** | **5.20%** | **94.80%** |

### Mathematical Disjointness Verification:
- $\text{Train} \cap \text{Validation} = 0$ events.
- $\text{Train} \cap \text{Test} = 0$ events.
- $\text{Validation} \cap \text{Test} = 0$ events.
- **Audit Verdict**: **PASS**. Zero event leakage across partitions.

---

## 3. Feature Leakage & Prohibited Metadata Audit

The feature extraction code was audited line-by-line:
```python
PRIMARY_FEATURES = ['log_frp', 'brightness_ti4', 'brightness_ti5', 'brightness_delta', 'scan', 'track', 'is_day']
```

### Prohibited Attributes Verification:
- **Geographic Fields**: `latitude`, `longitude`, `country`, `state`, `geographic_region` — **EXCLUDED**.
- **Temporal Fields**: `year`, `month`, `day`, `acq_datetime` — **EXCLUDED**.
- **Facility Metadata**: `facility_id`, `dist_to_facility`, `is_inside_facility`, `dist_to_observed_thermal_zone` — **EXCLUDED**.
- **Audit Labels & Metadata**: `external_source`, `external_record_id`, `spatial_match_distance`, `temporal_match_difference`, `label_tier`, `label_status`, `exclusion_reason` — **EXCLUDED**.

### Indirect Leakage Diagnostics:
1. **Missingness Leakage**: Audited missing values across all 7 features. Total `NaN` count = $0$. Missingness patterns do not encode class identity.
2. **Row Ordering**: Models ingest shuffled and partitioned matrices. Row index does not correlate with labels.
3. **Permitted Covariates as Regional Climate Proxies**: The audit notes that Longwave brightness temperature ($T_{\text{I5}}$) reflects ambient ground temperature. Flaring observations originate from a tropical coastal plain in Gujarat (mean $T_{\text{I5}} = 293.64\text{ K} \pm 3.98\text{ K}$), whereas test wildfires occur in temperate mountainous or continental climates at night (e.g. Oregon, Idaho, Colorado, where ambient $T_{\text{I5}}$ drops to $280-289\text{ K}$). Consequently, Decision Tree splits on $T_{\text{I5}} \le 291.23\text{ K}$ partially act as regional climate proxies. This finding reinforces why Logistic Regression (which balances $T_{\text{I4}}$ and $T_{\text{I5}}$ linearly) is superior to single-channel tree thresholds.

---

## 4. Preprocessing Audit

1. **StandardScaler Independence**: Verified that `scaler.fit(X_train)` was executed strictly on the TRAIN partition ($N=1,503$). Validation ($N=615$) and Test ($N=865$) were transformed via `scaler.transform()`. Zero test mean or variance leaked into feature scaling.
2. **Class Weighting**: `class_weight='balanced'` in `scikit-learn` computes weights inversely proportional to class frequencies strictly from the training targets passed to `.fit(X_train, y_train)`. Test set label frequencies were not used.
3. **Tree Models**: Decision Tree and Random Forest models were trained on unscaled features, preventing any scaling transformation leakage.
- **Audit Verdict**: **PASS**.

---

## 5. Model Configuration & Selection Audit

The audited model configurations:
1. **Logistic Regression**: `penalty='l2'`, $C=1.0$, `solver='lbfgs'`, `max_iter=1000`, `class_weight='balanced'`, `random_state=42`. Standardized inputs.
2. **Decision Tree**: `max_depth=3`, `criterion='gini'`, `class_weight='balanced'`, `random_state=42`. Unscaled inputs.
3. **Random Forest**: `n_estimators=100`, `max_depth=4`, `max_features='sqrt'`, `class_weight='balanced'`, `random_state=42`. Unscaled inputs.

### Random Forest Specification Check:
- The audit verified whether the introduction of Random Forest was post-hoc or authorized.
- **Finding**: Random Forest ($d=4$, $n=100$) was explicitly defined, justified, and frozen in [`Phase5F2_Model_Hardening_Spec.md`](file:///C:/Users/deepa/antigravity/ThermalSentinel/data/experiments/phase5f_baseline/Phase5F2_Model_Hardening_Spec.md) Section 3 prior to the execution of Phase 5F.3. It satisfies the condition of being a single, predefined nonlinear baseline.
- **Audit Verdict**: **PASS**.

---

## 6. Primary Result Recalculation & Confusion Matrix Audit

The auditor's standalone script recalculated all test metrics independently:

### Primary Baseline (Ablation A) Test Partition:

| Model | Audited Obs Macro F1 | Reported Obs Macro F1 | Audited ROC-AUC | Reported ROC-AUC | Audited Flare PR-AUC | Reported Flare PR-AUC | Audited WF PR-AUC | Reported WF PR-AUC | Audited Obs CM `[[TN,FP],[FN,TP]]` | Reported Obs CM | Audit Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Logistic Regression** | **0.6358** | 0.6358 | **0.9658** | 0.9658 | **0.4584** | 0.4584 | **0.9987** | 0.9987 | `[[30, 1], [113, 721]]` | `[[30, 1], [113, 721]]` | **EXACT MATCH** |
| **Decision Tree ($d=3$)** | **0.5933** | 0.5933 | **0.8277** | 0.8277 | **0.1427** | 0.1427 | **0.9934** | 0.9934 | `[[29, 2], [145, 689]]` | `[[29, 2], [145, 689]]` | **EXACT MATCH** |
| **Random Forest ($d=4$)** | **0.6050** | 0.6050 | **0.9702** | 0.9702 | **0.8028** | 0.8028 | **0.9988** | 0.9988 | `[[28, 3], [130, 704]]` | `[[28, 3], [130, 704]]` | **EXACT MATCH** |

### PR-AUC Prevalence Context Verification:
- Test Minority Prevalence (`GAS_FLARE`): **3.58%** ($31 / 865$). Random guess PR-AUC baseline = $0.0358$.
- Test Majority Prevalence (`WILDFIRE_CONFIRMED`): **96.42%** ($834 / 865$). Random guess PR-AUC baseline = $0.9642$.
- The audit confirms that the reported Wildfire PR-AUC ($0.9987$) is properly contextualized against the $96.42\%$ baseline, and Flare PR-AUC ($0.4584$) is correctly recognized as an enhancement of $12.8\times$ over random prevalence.

---

## 7. Event-Level Aggregation & Disproportionality Audit

### A. Event-Level Prediction Traceability:
Event predictions were recalculated using the frozen aggregation algorithm:
$$\bar{P}_e = \frac{1}{N_e} \sum_{i=1}^{N_e} P_i(\text{Wildfire}), \quad \hat{y}_e = \begin{cases} 1 & \text{if } \bar{P}_e \ge 0.5 \\ 0 & \text{if } \bar{P}_e < 0.5 \end{cases}$$

All 24 test events were audited across all three models:
- **Logistic Regression**: Flare Recall = **19/20 (95.0%)**, Wildfire Recall = **4/4 (100.0%)**, Event Macro F1 = **0.9316**. Event CM = `[[19, 1], [0, 4]]`.
- **Decision Tree**: Flare Recall = **19/20 (95.0%)**, Wildfire Recall = **4/4 (100.0%)**, Event Macro F1 = **0.9316**. Event CM = `[[19, 1], [0, 4]]`.
- **Random Forest**: Flare Recall = **19/20 (95.0%)**, Wildfire Recall = **4/4 (100.0%)**, Event Macro F1 = **0.9316**. Event CM = `[[19, 1], [0, 4]]`.

### B. Cedar Creek Observation Disproportionality Audit:
The audit quantified observation concentration across the 4 test wildfire complexes:
- **Cedar Creek Fire**: **695 observations** ($83.33\%$ of test wildfires, **$80.35\%$ of all test observations**).
- **Marshall Fire**: **76 observations** ($9.11\%$ of test wildfires, $8.79\%$ of test set).
- **Wildhorse Fire**: **38 observations** ($4.56\%$ of test wildfires, $4.39\%$ of test set).
- **W-5 Cold Springs Fire**: **25 observations** ($3.00\%$ of test wildfires, $2.89\%$ of test set).

### Forensic Analysis of Event Imbalance:
1. The top 1 wildfire complex contributes $83.33\%$ of test wildfire observations.
2. The top 2 complexes contribute $92.45\%$, and top 3 contribute $97.00\%$.
3. By contrast, the 20 flaring events contribute only 31 observations combined (mean $1.55$ obs/event).
4. **Audit Finding on Metric Framing**: Observation-level metrics are dominated by Cedar Creek plume pixels. However, describing event-level aggregation as "scientifically mandatory" in absolute terms is methodologically overstrong. Rather, event-level aggregation is an **essential complementary metric** required to evaluate incident-level performance without mega-fire distortion.

---

## 8. Critical Ablation Audits (D, E, B, C)

### A. Ablation D Audit (Without $\Delta T$):
- **Audited Metrics**:
  - Logistic Regression: Obs Macro F1 = **0.6318** (vs. 0.6358 baseline, $\Delta = -0.0040$), Event Macro F1 = **0.9316** ($19/20$ flare, $4/4$ wildfire).
  - Decision Tree ($d=3$): Obs Macro F1 = **0.5300** (vs. 0.5933 baseline), Event Macro F1 = **0.8737** ($18/20$ flare, $4/4$ wildfire).
  - Random Forest ($d=4$): Obs Macro F1 = **0.5444**, Event Macro F1 = **0.8737** ($18/20$ flare, $4/4$ wildfire).
- **Forensic Assessment**:
  - The hypothesis that Phase 5F performance collapsed without `brightness_delta` is **REFUTED**.
  - Logistic Regression is **ROBUST** to the removal of `brightness_delta` because standardized coefficients for $T_{\text{I4}}$ ($+2.17$) and $T_{\text{I5}}$ ($-2.52$) natively capture the difference.
  - Decision Tree and Random Forest are **MODERATELY SENSITIVE** because axis-aligned orthogonal cuts cannot compute differences obliquely, redistributing split importance to $T_{\text{I4}}$ ($48.69\%$) and $T_{\text{I5}}$ ($44.59\%$). However, event-level discrimination remains high ($18/20$ flare events, $4/4$ wildfire complexes).

### B. Ablation E Audit (Without FRP):
- **Audited Metrics**:
  - Logistic Regression: Obs Macro F1 = **0.6358** (identical to full baseline), Event Macro F1 = **0.9316** ($19/20$ flare, $4/4$ wildfire).
  - Decision Tree ($d=3$): Obs Macro F1 = **0.7068** (improved from 0.5933), Event Macro F1 = **0.9316** ($19/20$ flare, $4/4$ wildfire).
- **Forensic Assessment**:
  - The model does not depend on absolute radiant power scale (FRP). The apparent improvement in Decision Tree F1 is an artifact of simpler partition boundaries on this specific test set, not evidence that FRP has zero physical meaning.

### C. Ablation B Audit (Night-Only Benchmark):
- **Audited Metrics**:
  - Subset: 2,449 night observations (155 flare, 2,294 wildfire). Test partition: $736$ night observations ($31$ flare, $705$ wildfire).
  - Logistic Regression: Obs Macro F1 = **0.6416**, Event Macro F1 = **0.9158** ($19/20$ flare, $3/3$ wildfire).
  - Decision Tree ($d=3$): Obs Macro F1 = **0.3849**, Event Macro F1 = **0.6634** ($19/20$ flare, $1/3$ wildfire).
- **Forensic Assessment**:
  - Decision Tree fails at night (wildfire event recall drops to $1/3 = 33.3\%$) because cold night background temperatures ($T_{\text{I5}} \le 291\text{ K}$) trigger flare leaf nodes for low-intensity smoldering pixels.
  - Logistic Regression maintains high performance ($19/20$ flare, $3/3$ wildfire). However, the audit cautions that $N=3$ wildfire complexes in the night test partition is a small sample, and does not constitute "proof" of universal nocturnal performance.

### D. Ablation C Audit (Without `is_day`):
- **Audited Metrics**:
  - Logistic Regression: Obs Macro F1 = **0.6267**, Event Macro F1 = **0.9316** ($19/20$ flare, $4/4$ wildfire).
  - Decision Tree: Obs Macro F1 = **0.5615**, Event Macro F1 = **0.9316** ($19/20$ flare, $4/4$ wildfire).
- **Forensic Assessment**:
  - Confirms that removing the binary day flag from the full 865-row test set produces minimal variation.

---

## 9. Cross-Geographic Transferability Audit

- **Partition Policy**: Train on WA, OR, CA ($8$ fires, $70$ flare events). Test on TX, NM, ID, AZ, MT, CO ($9$ fires, $35$ flare events).
- **Audited Metrics**:
  - Logistic Regression: Obs Macro F1 = **0.8006**, Flare Recall = **49/53 (92.45%)**, WF Recall = **593/643 (92.22%)**, Event Macro F1 = **0.9353**, Flare Event Recall = **33/35 (94.29%)**, Wildfire Event Recall = **9/9 (100.0%)**.
  - Decision Tree: Event Macro F1 = **0.9062**, Flare Event Recall = **32/35 (91.43%)**, Wildfire Event Recall = **9/9 (100.0%)**.
  - Random Forest: Event Macro F1 = **0.9353**, Flare Event Recall = **33/35 (94.29%)**, Wildfire Event Recall = **9/9 (100.0%)**.
- **Audit Finding**:
  - Mathematical metrics are 100% verified.
  - The experiment demonstrates transferability to the **9 evaluated held-out incident complexes** across grass, shrub, and pine fuel types.
  - However, claims that this "validates universal cross-ecosystem generalization" are scientifically overbroad and must be restricted to the evaluated sample.

---

## 10. Satellite Platform Confounding Diagnostic Audit

- Audited Logistic Regression with `is_noaa20` added:
  - Standardized coefficient: $-0.4983$.
  - Corpus distribution: Flaring is $54.2\%$ NOAA-20; Wildfire is $13.1\%$ NOAA-20.
- **Audit Verdict**: **PASS**. Excluding satellite platform from the primary operational model is confirmed as sound engineering practice to prevent corpus provenance leakage.

---

## 11. Feature Importance vs. Physical Causation Audit

The audit inspected the standardized coefficients of Logistic Regression:
- `is_day`: $+4.3430$
- `brightness_delta`: $+4.4216$
- `brightness_ti4`: $+2.1678$
- `brightness_ti5`: $-2.5229$
- `log_frp`: $+0.5429$
- `track`: $+0.5018$
- `scan`: $-0.0298$

### Forensic Clarifications:
1. **Target Convention**: Binary target is $0 = \text{GAS\_FLARE}$ and $1 = \text{WILDFIRE\_CONFIRMED}$.
2. **Coefficient Interpretation**: A positive coefficient means that an increase in that feature increases the log-odds of **WILDFIRE_CONFIRMED**.
   - `brightness_delta` ($+4.4216$): In this corpus, large landscape wildfire fronts produce higher sub-pixel $\Delta T$ ($34.7\text{ K} \pm 16.6\text{ K}$) than small sub-pixel flaring points ($12.5\text{ K} \pm 2.3\text{ K}$).
   - `brightness_ti5` ($-2.5229$): Lower ambient longwave temperatures increase wildfire likelihood (nighttime wildland fires vs. warm tropical refinery pad).
3. **Causal Boundary**: High feature importance or large regression weights reflect **dataset-specific discriminative utility**, not fundamental thermodynamic causation.

---

## 12. Error Analysis & Misclassification Audit

The audit independently verified all misclassifications in the test partition for Logistic Regression:
- **False Positives for Flare (Wildfire Misclassified as Flare)**:
  - Total: **113 observations**.
  - **Cedar Creek Concentration**: $103 / 113$ ($91.2\%$) occurred within the Cedar Creek Fire.
  - **Physical Characteristics**: Mean $\text{FRP} = 3.29\text{ MW}$, $50\%$ have $\text{FRP} \le 1.14\text{ MW}$ (down to $0.58\text{ MW}$). Mean $\Delta T = 13.09\text{ K}$. $100\%$ occur at night.
  - **Audit Note**: The Phase 5F.3 report describes these pixels as "bordering sensor detection noise". The audit clarifies that this is an **interpretive physical hypothesis**, not directly measured sensor telemetry.
- **False Negatives for Flare (Flare Event Misclassified as Wildfire)**:
  - Total: Exactly **1 event** across the 20 test flare events ($19/20 = 95.0\%$ event recall).
  - In Logistic Regression: `EVT-EOG-FLARE-JAM-SOUTH-E-20260124` ($1$ obs, $P_{\text{wf}} = 0.6918$, $\text{FRP} = 1.82\text{ MW}$, $T_{\text{I4}} = 320.15\text{ K}$).

---

## 13. Robustness Classification Audit

The audit evaluated the sensitivity classifications assigned in Phase 5F.3:

| Experiment / Feature Removed | Assigned Classification | Audit Evaluation | Audit Justification |
| :--- | :---: | :---: | :--- |
| **Ablation D (Without $\Delta T$)** | **ROBUST** (LR) / **MODERATELY SENSITIVE** (DT, RF) | **JUSTIFIED** | LR Macro F1 drops by only $0.0040$; Event Macro F1 unchanged ($0.9316$, $19/20$ flare). DT drops $0.0633$ but retains $18/20$ flare events. |
| **Ablation E (Without FRP)** | **ROBUST** (LR, DT, RF) | **JUSTIFIED** | LR Macro F1 unchanged ($0.6358$); DT Macro F1 improves ($0.7068$); Event Macro F1 unchanged ($0.9316$). |
| **Ablation C (Without `is_day`)** | **ROBUST** (LR, DT, RF) | **JUSTIFIED** | LR Macro F1 drops $0.0091$; Event Macro F1 unchanged across all three models ($0.9316$). |
| **Ablation B (Night-Only)** | **ROBUST** (LR, RF) / **HIGHLY DEPENDENT** (DT) | **QUALIFIED PASS** | DT collapses to $0.3849$ Macro F1 and $1/3$ wildfire event recall. LR maintains $0.6416$ Macro F1 and $0.9158$ Event Macro F1, but test wildfire event sample is small ($N=3$). |

---

## 14. Preferred Experimental Model Selection Audit

The Phase 5F.3 selection of **Standardized Logistic Regression** was audited:
- **Tradeoff vs. Random Forest**: Random Forest achieved higher minority-class Flare PR-AUC ($0.8028$ vs. $0.4584$ in full test; $0.9537$ vs. $0.6106$ in cross-geographic test).
- **Why Logistic Regression is Superior as Baseline**:
  1. **Ablation Stability**: Completely robust to removal of $\Delta T$ ($\Delta \text{F1} = -0.0040$) and FRP ($\Delta \text{F1} = 0.0000$).
  2. **Mathematical Simplicity**: Convex loss prevents tree-depth memorization.
  3. **Nocturnal Resilience**: Unlike Decision Trees, it does not collapse at night.
  4. **Transparent Advisory Deployment**: Coefficients ($+4.42$ for $\Delta T$, $+2.17$ for $T_{\text{I4}}$, $-2.52$ for $T_{\text{I5}}$) can be deployed as an interpretable score inside SQL/edge telemetry pipelines without requiring complex runtime dependencies.
- **Audit Verdict**: **PASS**. The selection of Standardized Logistic Regression is methodologically sound.

---

## 15. Scientific Claim Audit & Required Phrasing Corrections

The audit searched [`Phase5F3_Controlled_Model_Hardening_Report.md`](file:///C:/Users/deepa/antigravity/ThermalSentinel/Phase5F3_Controlled_Model_Hardening_Report.md) for overclaims. The following 6 statements are formally flagged, with corrective phrasing established for subsequent design phases:

| # | Original Phase 5F.3 Claim | Methodological Problem | Required Corrective Scientific Phrasing |
| :---: | :--- | :--- | :--- |
| 1 | *"proving that physical discrimination does not rely on daytime solar reflection"* (Exec Summary & Sec 7C) | "Proving" is unscientific; evaluated sample size at night is limited ($N=3$ test wildfire complexes). | *"demonstrates that the Logistic Regression model maintained similar discrimination when evaluated exclusively on the nighttime observations in this corpus."* |
| 2 | *"This confirms that discrimination is governed by spectral brightness contrast..."* (Exec Summary & Sec 7B) | "Governed by" implies direct physical causation rather than model feature sensitivity. | *"under the evaluated dataset distribution, removing FRP did not degrade classification performance in Logistic Regression and Decision Tree."* |
| 3 | *"Validates that discrimination generalizes across grasslands (TX), piñon-juniper (NM), chaparral (AZ)..."* (Exec Summary & Sec 8) | Overstates generalizability; the test evaluated 9 specific held-out incident complexes. | *"Demonstrates successful transferability across the 9 evaluated held-out incident complexes across diverse western US fuel regimes."* |
| 4 | *"Cedar Creek represents 80.35% of all test observations... Event-level aggregation is scientifically mandatory"* (Sec 11) | "Scientifically mandatory" is an absolute methodological claim. | *"Event-level aggregation is an essential complementary metric to prevent disproportionate distortion from mega-fires with hundreds of observations."* |
| 5 | *"bordering sensor detection noise"* (Sec 12A) | Sensor detection noise is an interpretive engineering hypothesis, not direct telemetry. | *"bordering the empirical detection limits of the sensor for diffuse, low-intensity thermal anomalies."* |
| 6 | *"High Generalizability: Achieved 0.9353 Event Macro F1"* (Sec 14) | Generalizability is constrained by the India-flaring / US-wildfire geographic pairing. | *"Consistent Cross-Incident Performance: Achieved 0.9353 Event Macro F1 on the evaluated holdout partition."* |

---

## 16. Final Scientific Assessment

### Answers to Mandatory Forensic Questions:

1. **Are the Phase 5F.3 numerical results reproducible?**  
   **YES**. 100% of numerical values, ratios, confusion matrices, and PR-AUC figures were independently reproduced.
2. **Is there evidence of train/test leakage?**  
   **NO**. Scalers were fitted strictly on TRAIN; test was evaluated once; zero feature leakage.
3. **Is there evidence of event leakage?**  
   **NO**. Disjointness checks confirmed $0$ overlapping events across partitions.
4. **Is Logistic Regression reasonably stable across tested ablations?**  
   **YES**. Performance remained stable across ablations of $\Delta T$, FRP, and `is_day`.
5. **Does removing `brightness_delta` materially damage Logistic Regression?**  
   **NO**. Macro F1 dropped by only $0.0040$; Event Macro F1 was unchanged ($0.9316$, $19/20$ flare events, $4/4$ wildfire complexes).
6. **Does nighttime-only evaluation support continued feasibility?**  
   **YES for Logistic Regression** (Event Macro F1: $0.9158$); **NO for Decision Tree** (Event Macro F1: $0.6634$).
7. **Does the cross-geographic test provide evidence of transfer to selected holdout incidents?**  
   **YES**. All models achieved $9/9$ ($100.0\%$) wildfire event recall and $\ge 32/35$ ($>91\%$) flare event recall on unseen incidents.
8. **Is the current evidence sufficient to call the classifier generalized?**  
   **NO**. It is an experimental binary discriminator evaluated on specific geographic domains (Gujarat flaring vs. US wildfires). Universal generalization cannot be claimed.
9. **Is the current evidence sufficient to integrate it as an advisory component?**  
   **YES**. The model is sufficiently hardened to serve as a constrained, advisory evidence source under Layer 3 of the ThermalSentinel pipeline.
10. **What limitations must remain visible in the product?**  
    - Unsupported classes (`AGRICULTURAL_BURN`, `INDUSTRIAL_FIRE`, `OTHER`).
    - Geographic flaring constraint (Gujarat baseline only; US/Permian unverified).
    - Cannot override deterministic spatial buffer containment or empirical historical baselines.

---

## 17. Final Status and Verdict

```
PHASE 5F.4 STATUS

Training performed: NO
Dataset modified: NO
Production code modified: NO
Labels modified: NO
Independent metric recalculation: PASS
Leakage audit: PASS
Event aggregation audit: PASS
Ablation audit: PASS
Cross-geographic audit: PASS
Scientific-claim audit: PASS

FINAL VERDICT:
A. HARDENING VERIFIED — PROCEED TO INTEGRATION DESIGN

EXACT NEXT ACTION:
Author Phase 6.1 Advisory Integration Specification defining the multi-layered orchestration schema, advisory probability thresholding, and guardrail rules for deploying the Logistic Regression discriminator within ThermalSentinel.
```
