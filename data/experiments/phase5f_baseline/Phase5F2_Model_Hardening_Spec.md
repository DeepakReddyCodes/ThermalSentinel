# ThermalSentinel — Phase 5F.2: Controlled Model Hardening Specification (Phase 5F.3 Design)

**Document Type**: Engineering Design & Evaluation Specification  
**Status**: `APPROVED SPECIFICATION — READY FOR PHASE 5F.3 CONTROLLED EXECUTION`  
**Model Training in this Phase**: `STRICTLY PROHIBITED (SPECIFICATION ONLY)`  

---

## 1. Model Purpose & Operational Scope

The classifier developed under this specification shall be designated formally as:

> **"Experimental Thermal Source Discriminator"**

### A. Supported Binary Scope:
- **Class 0**: `GAS_FLARE` (Point-source, high-temperature industrial hydrocarbon flaring; $T \ge 1600\text{ K}$).
- **Class 1**: `WILDFIRE_CONFIRMED` (Open-air, landscape-scale wildland vegetative biomass combustion; $T \approx 800-1200\text{ K}$).

### B. Explicitly Prohibited Claims & Unsupported Classes:
- `INDUSTRIAL_FIRE`: **UNSUPPORTED**. Structural factory fires, chemical refinery fires, and petroleum storage tank explosions are not represented.
- `AGRICULTURAL_BURN`: **UNSUPPORTED**. Crop residue burning (e.g. paddy stubble, sugarcane trash) is not represented.
- `OTHER`: **UNSUPPORTED**. Heuristic negative classes are prohibited.
- The classifier shall be deployed exclusively as an **advisory likelihood score** ($P_{\text{flare}}$ vs. $P_{\text{wildfire}}$), never as an unconstrained autonomous multi-source classifier.

---

## 2. Input Features & Feature Partitioning Policy

### A. Primary Candidate Operational Features:
1. `log_frp`: Natural logarithm $\ln(1 + \text{frp})$, where $\text{frp}$ is Fire Radiative Power in MW.
2. `brightness_ti4`: 3.74 μm Midwave Infrared (MWIR) brightness temperature in Kelvin.
3. `brightness_ti5`: 11.45 μm Longwave Infrared (LWIR) brightness temperature in Kelvin.
4. `brightness_delta`: Midwave-to-longwave spectral contrast $\Delta T = T_{\text{I4}} - T_{\text{I5}}$ in Kelvin.
5. `scan`: Cross-track pixel footprint dimension in kilometers ($0.32-0.80\text{ km}$).
6. `track`: Along-track pixel footprint dimension in kilometers ($0.33-0.60\text{ km}$).
7. `is_day`: Diurnal solar background flag ($1.0$ for Day, $0.0$ for Night).

### B. Satellite Platform Policy:
- `satellite`: **EXCLUDED FROM PRIMARY MODEL**.
- Rationale: The training corpus exhibits class-satellite correlation (flaring is 54% NOAA-20, wildfire is 13% NOAA-20). Including satellite introduces an artificial proxy for class provenance rather than physical signal.

### C. Strictly Prohibited Attributes (Geographic & Target Leakage):
The following 17 fields must be strictly blocked from entering the feature matrix:
```
PROHIBITED ATTRIBUTES:
- latitude, longitude
- country, state, geographic_region
- year, month, day, acq_datetime
- facility_id, dist_to_facility, is_inside_facility, dist_to_observed_thermal_zone
- external_source, external_record_id, spatial_match_distance, temporal_match_difference
- label_tier, label_status, exclusion_reason
```
Any derived feature that directly or indirectly encodes geographic location, calendar year, or facility proximity is strictly prohibited.

---

## 3. Models to Evaluate in Phase 5F.3

Phase 5F.3 shall evaluate a disciplined, conservative suite of models to test whether the radiometric signal survives model variation without overfitting:

1. **Model Baseline 1: Standardized Logistic Regression**
   - Regularized linear boundary: $L_2$ penalty ($C=1.0$).
   - Class weighting: `class_weight='balanced'`.
   - Solver: `lbfgs`, max iterations: 1000.
2. **Model Baseline 2: Shallow Decision Tree**
   - Constrained depth: `max_depth=3` (or `max_depth=4`).
   - Split criterion: Gini impurity / entropy.
   - Class weighting: `class_weight='balanced'`.
   - Purpose: Direct inspection of orthogonal decision boundaries and feature thresholds.
3. **Model Baseline 3: Conservative Shallow Random Forest**
   - Ensemble of 100 shallow trees: `n_estimators=100`, `max_depth=4`, `max_features='sqrt'`.
   - Class weighting: `class_weight='balanced'`.
   - Purpose: Assess whether variance reduction improves event-level calibration without memorizing specific fires.
4. **Prohibited Architectures**:
   - Deep neural networks: **PROHIBITED** (excessive parameterization for 122 physical events).
   - Unconstrained / deep gradient boosting (XGBoost): **PROHIBITED** unless strict tree-depth ($d \le 3$) and conservative regularization are documented.

---

## 4. Preprocessing & Test-Set Leakage Prevention

1. **Deterministic Transformations**: `log1p(frp)` and `brightness_delta` may be computed across the dataset as they are sample-independent mathematical operations.
2. **Parametric Scaling**: If standardization is applied (`StandardScaler`), the mean $\mu$ and standard deviation $\sigma$ **must be fitted strictly on the TRAIN partition**:
   $$\mu_{\text{train}} = \frac{1}{N_{\text{train}}} \sum x_i,\quad \sigma_{\text{train}} = \sqrt{\frac{1}{N_{\text{train}}} \sum (x_i - \mu_{\text{train}})^2}$$
   `scaler.transform()` shall be applied to VALIDATION and TEST.
3. **Partition Isolation**: The TEST partition must remain sealed until final evaluation. No hyperparameter tuning, feature pruning, or threshold adjustments may be made after inspecting TEST results.

---

## 5. Class Imbalance & Evaluation Metrics

The evaluated corpus exhibits an observation imbalance of approximately $5.2\%$ flaring to $94.8\%$ wildfire, but an event-level ratio of $105$ flaring events to $17$ wildfire complexes.

### A. Primary Evaluation Metrics:
1. **Macro-Averaged F1-Score**: $\frac{1}{2} (F_{1,\text{flare}} + F_{1,\text{wildfire}})$. (Enforces equal importance across classes regardless of observation counts).
2. **Minority-Class PR-AUC**: Area under the Precision-Recall curve for `GAS_FLARE`. Must be reported alongside class prevalence ($3.6\%$ in test).
3. **Majority-Class PR-AUC**: Area under the Precision-Recall curve for `WILDFIRE_CONFIRMED`, reported alongside class prevalence ($96.4\%$ in test).
4. **Receiver Operating Characteristic AUC (ROC-AUC)**.
5. **Per-Class Precision and Recall**.
6. **2x2 Confusion Matrices** with exact observation counts.

### B. Prohibited Metric Practice:
- Reporting overall unweighted accuracy as the primary metric is **STRICTLY PROHIBITED** (a dummy classifier achieves $96.4\%$ accuracy by predicting wildfire on every test row).

---

## 6. Event-Level Aggregation & Evaluation Protocol

Event-level evaluation is mandatory to prevent large fires (e.g. Cedar Creek with 695 obs) from dominating evaluation metrics.

### A. Aggregation Algorithm:
For each physical event group $e$ containing $N_e$ observations:
$$\bar{P}_e = \frac{1}{N_e} \sum_{i=1}^{N_e} P(y_i = \text{Wildfire} \mid \mathbf{x}_i)$$
$$\hat{y}_e = \begin{cases} 1\ (\text{Wildfire}) & \text{if } \bar{P}_e \ge 0.5 \\ 0\ (\text{Flare}) & \text{if } \bar{P}_e < 0.5 \end{cases}$$

### B. Reporting Requirements:
- Event-level Macro F1.
- Event-level Confusion Matrix: $\begin{pmatrix} \text{TN}_{\text{evt}} & \text{FP}_{\text{evt}} \\ \text{FN}_{\text{evt}} & \text{TP}_{\text{evt}} \end{pmatrix}$.
- **Mandatory Denominators**: All event recall figures must explicitly report the sample denominator (e.g., $19/20$ flare events, $4/4$ wildfire events).

---

## 7. Required Controlled Ablation Suite in Phase 5F.3

Phase 5F.3 must execute the following five controlled ablation experiments:

1. **Ablation A — Full Primary Feature Set**: Baseline with all 7 primary radiometric features.
2. **Ablation B — Night-Only Benchmark**: Filter dataset to `day_night == 'N'` and drop `is_day`. (Verifies that performance does not rely on daytime solar reflection).
3. **Ablation C — Without `is_day`**: Evaluate full dataset with diurnal flag removed. (Verifies whether diurnal flag introduces shortcuts).
4. **Ablation D — Without `brightness_delta`**: Strip $T_{\text{I4}} - T_{\text{I5}}$ and evaluate with raw $T_{\text{I4}}$, $T_{\text{I5}}$, FRP. (Quantifies model dependence on spectral contrast).
5. **Ablation E — Without `log_frp`**: Strip FRP and evaluate on spectral temperatures and footprint dimensions only. (Quantifies reliance on total radiant power vs. spectral shape).

Ablations are diagnostic; they must not be used to iteratively tune the final model on the test set.

---

## 8. Physical Interpretation Guardrail

The Phase 5F.3 report must enforce strict demarcation between statistical correlation and physical causation:

- **Prohibited Phrasing**:
  - *"$\Delta T$ causes the classifier to detect flares."*
  - *"74.7% of the physical signal is in $\Delta T$."*
  - *"The model proves thermal signatures are unique."*
- **Required Scientific Phrasing**:
  - *"$\Delta T$ was the dominant split feature utilized by the Decision Tree under this evaluated dataset distribution."*
  - *"The experimental results demonstrate that sub-pixel midwave-to-longwave contrast provides measurable discriminative signal within this corpus."*

---

## 9. Explicit Documentation of Generalization Limitations

The Phase 5F.3 documentation must prominently disclose all domain constraints:
1. **Flaring Geographic Scope**: All 155 flaring observations originate from a single industrial complex in Gujarat, India. Cross-basin flaring generalization (e.g. Permian Basin, North Sea, Persian Gulf) remains unverified.
2. **Wildfire Geographic Scope**: All 2,828 wildfire observations originate from 17 incident complexes in the United States. Indian forest fire regimes remain unverified due to lack of non-circular authoritative dispatch perimeters.
3. **Temporal Asymmetry**: Flaring observations are from 2026; wildfire observations are from 2020–2022.
4. **Diurnal Asymmetry**: Flaring baseline contains zero daytime overpasses; wildfire contains 18.9% daytime overpasses.
5. **Absent Combustion Classes**: Zero crop residue fires, zero structural fires, zero prescribed burns.

---

## 10. Future Data Acquisition Priorities

Data expansion must proceed strictly according to the following priority hierarchy:

1. **Priority 1 (Cross-Basin Flaring)**: Ingest authoritative persistent flaring centroids from additional continental basins (e.g. Permian Basin, USA; Bakken, USA; North Sea, Europe) to eliminate the India-only flaring geographic constraint.
2. **Priority 2 (Indian Wildfire Operational Records)**: Acquire non-circular, ground-verified wildland fire records from Indian State Forest Departments or National Disaster Management Authority with confirmed GIS polygons and sub-day timestamps.
3. **Priority 3 (Independent Agricultural Residue Burning)**: Acquire authoritative ground-based harvest burning permits or ground dispatch records (e.g. Punjab/Haryana or US Midwest) to establish a distinct `AGRICULTURAL_BURN` class.
4. **Priority 4 (Industrial Structural / Non-Flare Fires)**: Acquire authoritative municipal fire department dispatch records for industrial facility fires to separate flares from facility emergencies.

*Strict Rule*: Never generate training labels by intersecting FIRMS with land cover, season, or facility buffers alone.

---

## 11. Production Integration Policy & Architecture

The classifier developed under this specification is strictly an **evidence source**, not an autonomous decision-maker.

### Multi-Layered Architecture:
```
[ NASA FIRMS Active Thermal Telemetry ]
                 │
                 ▼
[ Layer 1: Deterministic Geospatial Buffer Association (0-15 km) ]
                 │
                 ▼
[ Layer 2: Empirical Facility Baseline & Thermal Profile (Historic MW) ]
                 │
                 ▼
[ Layer 3: Experimental Thermal Source Discriminator (Phase 5F.3 ML Score) ]
                 │  - Advisory probability: P(Flare) vs. P(Wildfire)
                 │  - Radiometric features only; no lat/lon or facility ID
                 ▼
[ Layer 4: Source Hypothesis Formulation (FLARING vs. EXTERNAL_FIRE) ]
                 │
                 ▼
[ Layer 5: Uncertainty Quantification & Conflict Detection ]
                 │
                 ▼
[ Layer 6: Next-Best-Evidence (NBE) Sensor Dispatch Recommendation ]
                 │
                 ▼
[ Layer 7: Operational Investigation Priority Queue ]
```

The classifier **MUST NOT** override:
- Deterministic facility boundary containment.
- Empirical non-zero flaring baseline history.
- Sensor quality flags or saturation warnings.

---

## 12. Objective Acceptance Criteria for Phase 5F.3

Phase 5F.3 shall be deemed successful only if all of the following 12 criteria are satisfied:

1. **Zero Partition Leakage**: Zero physical event groups cross between Train, Validation, and Test.
2. **Zero Metadata Leakage**: Feature matrix is verified free of geographic, calendar, and facility metadata.
3. **Independent Preprocessing**: Scalers and transformations are fitted strictly on TRAIN.
4. **Sealed Test Set**: Test partition is evaluated once; zero test-adaptive hyperparameter tuning.
5. **Metric Completeness**: Macro F1, minority-class PR-AUC, majority-class PR-AUC, and ROC-AUC are reported.
6. **Prevalence Reporting**: Class prevalence is reported alongside all PR-AUC numbers.
7. **Denominator Transparency**: All event-level recall figures include their exact sample denominators.
8. **Night-Only Ablation Executed**: Model performance is evaluated on the nighttime-only subset.
9. **Feature Ablations Executed**: Ablations for $\Delta T$, FRP, and `is_day` are documented.
10. **Conservative Phrasing**: Documentation avoids absolute terms ("proves", "universal", "production-ready").
11. **Reproducibility**: All reported metrics are independently recalculable from saved prediction JSONs.
12. **Production Safety**: No unconstrained production code or API integration is deployed.

---

```
PHASE 5F.2 STATUS:
[SPECIFICATION APPROVED — READY FOR PHASE 5F.3 CONTROLLED EXECUTION]
```
