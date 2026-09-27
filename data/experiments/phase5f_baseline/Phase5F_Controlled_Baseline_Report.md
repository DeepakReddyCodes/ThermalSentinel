# ThermalSentinel — Phase 5F: Controlled Baseline Classifier Experiment Report
*(Officially Corrected per Phase 5F.1 Forensic Audit on September 11, 2026)*

**Execution Date**: September 11, 2026  
**Experimental Status**: `CONTROLLED BASELINE EVALUATION COMPLETE — RADIOMETRIC SIGNAL DEMONSTRATED`  
**Integration Status**: `EXPERIMENTAL BENCHMARK ONLY — PROHIBITED FROM UNCONSTRAINED PRODUCTION REPLACEMENT`  

**Strict Methodological Controls Enforced**:
- Zero modifications to `data/training_v4/` or production code.
- Strict event-level group-preserved splitting (zero physical event leakage across partitions).
- Re-balanced test partitioning (20 flaring events / 31 obs; 4 diverse wildfire events / 834 obs).
- Complete stripping of all geographic, temporal, and facility metadata (`latitude`, `longitude`, `geographic_region`, `country`, `year`, `month`, `acq_datetime`, `facility_id`).
- Primary evaluation conducted strictly on standardized radiometric features (`log_frp`, $T_{\text{I4}}$, $T_{\text{I5}}$, $\Delta T$, `scan`, `track`, `is_day`).
- Dual-level reporting: Observation-Level vs. Event-Level Aggregation with explicit sample denominators.

---

## 1. Scientific Target Framing & Explicit Boundary Limitations

The experimental target in Phase 5F is formally defined as:

> **"Controlled binary discrimination between gas-flaring observations from Gujarat, India and wildfire observations from geographically diverse US wildfire incidents."**

### Explicit Boundary Limitations:
1. **NOT a General Industrial-Fire Detector**: The industrial class consists exclusively of persistent petroleum refinery process flaring. It does not model structural fires, tank explosions, or chemical processing.
2. **NOT an Agricultural Residue Detector**: Crop stubble burning and rangeland burns are completely absent from the current supervised training corpus.
3. **NOT an All-Source Generalizer**: Models evaluated in this benchmark demonstrate radiometric separability between point-source high-temperature gas flaring and wildland vegetation combustion within this specific corpus. They must not be deployed as unconstrained multi-class fire classifiers.
4. **NOT Production-Grade Source Attribution**: This classifier provides an experimental advisory signal; it is not validated for automated operational decision-making without corroborating geospatial and behavioural telemetry.

---

## 2. Dataset Reconstruction & Controlled Split Inventory

Filtered from `data/training_v4/training_candidates_v4.csv` to include only eligible `MATCHED`, `TIER_1` and `TIER_2` instances:
- Total Eligible Records: **2,983 observations** (155 `GAS_FLARE`, 2,828 `WILDFIRE_CONFIRMED`).
- Total Physical Events: **122 unique physical events** (105 daily flaring passes, 17 wildfire complexes).

### Group-Preserved Event Partitioning:
To rectify Phase 5E's test set imbalance (where Cedar Creek monopolized 78% of test rows and flaring had only 5 rows), the partitions were re-balanced at the physical event level:

| Partition | Flaring Events | Flaring Obs | Wildfire Events | Wildfire Obs | Total Obs | Event Breakdown |
|---|---|---|---|---|---|---|
| **TRAIN** | **65** | 95 | **10** | 1,408 | **1,503** | Bolt Creek (WA), McFarland (CA), Kidd (TX), Two and a Half (ID), Smoke Stack Lightning (TX), River (CA), Antelope (CA), Gass Flats (MT), Hermits Peak (NM), Canadian River Bottom (TX) |
| **VALIDATION** | **20** | 29 | **3** | 586 | **615** | Whitney (WA), Southern (CA), Bottom (AZ) |
| **TEST** | **20** | 31 | **4** | 834 | **865** | Cedar Creek (OR), Marshall (CO), Wildhorse (ID), W-5 Cold Springs (CA) |
| **All Usable** | **105** | **155** | **17** | **2,828** | **2,983** | **122 Physical Event Complexes** |

---

## 3. Non-ML Domain Confounding Diagnostics

Before training, diagnostic tests verified the extreme confounding power of non-physical metadata variables:

1. **Year Rule (`acq_datetime[:4] == '2026'`)**:
   - Rule: If Year = 2026 $\implies$ Flare, else Wildfire.
   - **Diagnostic Accuracy: 100.00%**.
   - *Implication*: Including timestamp or year allows an ML model to achieve 100% accuracy while learning zero physics. `acq_datetime` and `year` were completely stripped.
2. **Day/Night Rule (`day_night == 'D'`)**:
   - Rule: If Day $\implies$ Wildfire.
   - **Precision: 100.00%** (100% of daytime detections are Wildfire).
   - *Implication*: Because flaring baseline data contains zero daytime overpasses, daytime detection provides an artificial one-way indicator.
3. **Satellite Platform Distribution**:
   - Flaring: 54.2% NOAA-20, 45.8% Suomi-NPP.
   - Wildfire: 13.4% NOAA-20, 86.6% Suomi-NPP.
   - *Implication*: Satellite platform is correlated with class origin and was excluded from the primary model.

---

## 4. Experiment A — Controlled Radiometric Baseline

Evaluated on the held-out `TEST` partition (20 unseen flaring events, 4 unseen wildfire complexes):

### A. Test Performance Summary:

| Model Architecture | Observation Macro F1 | ROC-AUC | Wildfire PR-AUC (Prevalence: 96.4%) | Flaring PR-AUC (Prevalence: 3.6%) | Flaring Precision | Flaring Recall | Wildfire Precision | Wildfire Recall | Event Macro F1 | Event Flare Recall | Event Wildfire Recall |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Logistic Regression** (Balanced) | **0.6358** | **0.9575** | **0.9984** | **0.8208** | 0.2098 ($30/143$) | **0.9677** ($30/31$) | **0.9986** ($721/722$) | 0.8645 ($721/834$) | **0.9316** | **95.0% (19/20)** | **100.0% (4/4)** |
| **Decision Tree** ($d=3$, Balanced) | **0.5933** | 0.8797 | 0.9934 | 0.7412 | 0.1667 ($29/174$) | **0.9355** ($29/31$) | **0.9971** ($689/691$) | 0.8261 ($689/834$) | **0.9316** | **95.0% (19/20)** | **100.0% (4/4)** |

### B. Confusion Matrices (Test Partition):
```
Observation-Level Confusion Matrix (Logistic Regression):
                   Predicted Flare   Predicted Wildfire
Actual Flare             30                  1
Actual Wildfire         113                721

Event-Level Confusion Matrix (Logistic Regression & Decision Tree):
                   Predicted Flare   Predicted Wildfire
Actual Flare             19                  1
Actual Wildfire           0                  4
```

*Event Breakdown Note*: Exactly 1 out of 20 flare test events (`EVT-EOG-FLARE-JAM-SOUTH-W-20260126`) was misclassified as wildfire (Mean Prob = 0.8001), yielding a true event recall of **95.0% (19/20)**. All 4 wildfire complexes were correctly classified (**100.0% [4/4]**).

### C. PR-AUC and Class Imbalance Nuance:
- In `TEST`, Wildfire constitutes **834 out of 865 observations (96.42% prevalence)**.
- A baseline dummy classifier outputting constant positive predictions achieves a PR-AUC of **0.9642**. Therefore, the observed Wildfire PR-AUC of **0.9984** reflects an incremental improvement from 0.9642 to 0.9984.
- For the minority class (`GAS_FLARE`, prevalence = $3.58\%$), Flaring PR-AUC is **0.8208** (against a 0.0358 random baseline), demonstrating substantial discriminative capacity.

### D. Feature Importance Analysis (Decision Tree):
```
Feature                      Importance Gain     Model Role
─────────────────────────────────────────────────────────────────────────────
brightness_delta (TI4 - TI5)    0.7472 (74.7%)   Primary split separator in this tree
brightness_ti5                  0.1488 (14.9%)   Background ambient temperature
track                           0.0384 (3.8%)    Sensor scan geometry
scan                            0.0338 (3.4%)    Sensor scan geometry
log_frp                         0.0319 (3.2%)    Fire Radiative Power
is_day                          0.0000 (0.0%)    Diurnal flag (Unused by tree)
brightness_ti4                  0.0000 (0.0%)    Subsumed by delta
```

*Interpretation Guardrail*: `brightness_delta` was the dominant feature utilized by this shallow Decision Tree under the evaluated dataset distribution. This reflects strong empirical contrast in the data, but should not be characterized as proof of direct physical causation without comprehensive radiative transfer modeling.

---

## 5. Experiment B — Night-Only Ablation

To evaluate whether discrimination survived when daytime wildfire detections were removed, all daytime rows were stripped ($N = 2,449$ nighttime rows remaining; 155 Flare, 2,294 Wildfire across all 17 fires):

| Model Architecture | Observation Macro F1 | Flaring Precision | Flaring Recall | Wildfire Precision | Wildfire Recall | Event Macro F1 | Event Flare Recall | Event Wildfire Recall |
|---|---|---|---|---|---|---|---|---|
| **Logistic Regression (Night-Only)** | **0.6416** | 0.2143 | **0.9677** ($30/31$) | **0.9985** | 0.8690 | **0.9158** | **95.0% (19/20)** | **100.0% (4/4)** |
| **Decision Tree (Night-Only)** | **0.3849** | 0.0898 | **0.9677** ($30/31$) | **0.9950** | 0.5401 | **0.6634** | **95.0% (19/20)** | 75.0% (3/4) |

*Interpretation*: In Logistic Regression, night-only Macro F1 (0.6416) matches full-dataset Macro F1 (0.6358), demonstrating that discrimination does not strictly require daytime observations. However, in the shallow Decision Tree, night-only Macro F1 declined to 0.3849, indicating sensitivity to cutpoint shifts on unstandardized nighttime features.

---

## 6. Experiment C — Cross-Geographic Wildfire Holdout

To evaluate whether a model trained on Pacific Northwest / California conifer/chaparral fires generalizes to unseen wildfire ecosystems, the dataset was partitioned geographically:
- **TRAIN Domain (WA, OR, CA)**: 8 physical fires (Bolt Creek, Cedar Creek, River, W-5 Cold Springs, Southern, McFarland, Antelope, Whitney) + 70 flaring events = **2,287 observations**.
- **TEST Holdout Domain (TX, NM, ID, AZ, MT, CO)**: 9 unseen physical fires across Southern Plains, Rocky Mountains, and Southwest Desert + 35 flaring events = **696 observations**.

### Cross-Geographic Holdout Test Results:

| Model Architecture | Observation Macro F1 | ROC-AUC | Flaring Precision | Flaring Recall | Wildfire Precision | Wildfire Recall | Event Macro F1 | Event Flare Recall | Event Wildfire Recall |
|---|---|---|---|---|---|---|---|---|
| **Logistic Regression** | **0.8006** | **0.9754** | 0.4000 | **0.9434** ($50/53$) | **0.9944** | 0.9114 ($593/643$) | **0.9353** | **94.3% (33/35)** | **100.0% (9/9)** |
| **Decision Tree** | **0.6868** | 0.9080 | 0.3125 | **0.9434** ($50/53$) | **0.9944** | 0.8289 ($533/643$) | **0.9062** | **91.4% (32/35)** | **100.0% (9/9)** |

```
Cross-Geographic Holdout Event Confusion Matrix (Decision Tree):
                   Predicted Flare   Predicted Wildfire
Actual Flare             32                  3
Actual Wildfire           0                  9
```

*Interpretation*: The experiment provides empirical evidence consistent with generalization across the nine evaluated holdout wildfire complexes in the interior West and Southern Plains (9 out of 9 fires correctly classified at the event level). However, because all gas flaring originated from a single industrial basin in India, cross-basin flaring generalization has not been tested.

---

## 7. Experiment D — Satellite Platform Ablation

Tested whether including the `satellite` platform (`NOAA-20` vs `Suomi-NPP`) enhances physical modeling or introduces domain bias:
- Model A (Without Satellite): Test Macro F1 = **0.6358**
- Model B (With Satellite): Test Macro F1 = **0.6565**
- Satellite Coefficient in Logistic Regression: **-0.4983** (strongly negative weight on NOAA-20, biasing toward flaring).

**Scientific Verdict**: The slight 0.02 lift in Macro F1 is an artifact of class provenance: 54% of flaring data is on NOAA-20, while only 13% of wildfire data is on NOAA-20. The model learned that NOAA-20 is correlated with flaring in this dataset. **Satellite platform acts as a confounded proxy and MUST be excluded from operational inference.**

---

## 8. Explicit Answers to Final Questions

1. **Does radiometric information provide useful discrimination?**  
   **YES**. Midwave-to-longwave brightness temperature divergence ($T_{\text{I4}} - T_{\text{I5}}$) and Fire Radiative Power (FRP) provide strong discriminative signal within this corpus.
2. **How much performance depends on day/night composition?**  
   **MINIMAL FOR LOGISTIC REGRESSION**. Stripping daytime detections in Experiment B yielded an Observation Macro F1 of **0.6416** and an Event Macro F1 of **0.9158**, matching full-dataset performance.
3. **How much performance depends on satellite/platform?**  
   **NEGLIGIBLE FOR PHYSICS, BUT HIGH FOR CONFOUNDING**. Adding satellite platform slightly increases Macro F1 (+0.02) by exploiting class provenance imbalances. It must remain excluded.
4. **How much performance survives unseen wildfire geographic regimes?**  
   **EVIDENCE CONSISTENT WITH GENERALIZATION ACROSS EVALUATED REGIMES**. In Experiment C, models trained only on WA/OR/CA correctly classified **9 out of 9 unseen physical wildfire events (100% [9/9])** across Texas, New Mexico, Idaho, Arizona, Montana, and Colorado (Event Macro F1: **0.9353**).
5. **Does the current corpus support a credible baseline classifier?**  
   **YES, for binary physical discrimination between industrial gas flaring and wildland vegetative fire within this corpus**.
6. **What limitations remain?**  
   - Flaring data originates from a single industrial basin (Gujarat, India); cross-basin flaring data is not yet incorporated.
   - Agricultural stubble burning, prescribed fuel treatments, and industrial structure fires are completely absent.
   - Low-intensity smoldering wildfire margins are sometimes predicted as flaring at the pixel level due to low $\Delta T$.
   - Sample size of physical wildfire events remains modest ($N = 17$).
7. **Is additional data acquisition required?**  
   **YES, before any generalized multi-source classifier is built**. Specifically, agricultural residue burns and flaring from additional geographic basins are needed.
8. **Is the supervised classifier suitable for integration into ThermalSentinel?**  
   **NO, NOT FOR UNCONSTRAINED PRODUCTION REPLACEMENT**. The model is suitable as an **experimental source attribution advisory tag** (`EXPERIMENTAL_THERMAL_DISCRIMINATOR`), but MUST NOT replace the deterministic geospatial and NBE infrastructure built in Phases 1–4.

---

```
PHASE 5F STATUS:
[CONTROLLED BASELINE EVALUATION COMPLETE — RADIOMETRIC SIGNAL DEMONSTRATED — RECORD OFFICIALLY CORRECTED]
```
