# ThermalSentinel — Phase 5E Verification Audit Report

**Audit Date**: September 11, 2026  
**Audit Objective**: Independent forensic verification of the Phase 5E implementation, data integrity, temporal semantics, and supervised ML readiness before any model training in Phase 5F.  
**Auditor Policy**: Zero code modifications to production, zero modifications to `training_v4`, zero model training, and zero synthetic data creation.

---

## 1. Actual Artifacts Verification & Exact Recalculation

All repository files in `data/training_v4/` and `data/raw/` were verified directly via cryptographic and programmatic inspection:

### A. Artifact Inventory & Integrity:
| Artifact Path | Format | Size | Records | Integrity Verification |
|---|---|---|---|---|
| `data/training_v4/training_candidates_v4.csv` | CSV | 2,136,323 B | 3,770 rows | Valid CSV; 1 header + 3,770 records. Zero missing fields. |
| `data/training_v4/training_candidates_v4.json` | JSON | 5,312,872 B | 3,770 objects | Valid JSON; exact 1-to-1 parity with CSV. |
| `data/training_v4/dataset_manifest_v4.json` | JSON | 1,073 B | N/A | Valid JSON manifest documenting inventory and checksums. |
| `data/training_v4/independent_label_match_audit_v4.json` | JSON | 8,313 B | N/A | Valid JSON audit documenting matching parameters. |
| `data/training_v4/label_sources_v4.json` | JSON | 3,515 B | N/A | Valid JSON catalog of external data sources. |
| `data/raw/WFIGS_perimeters_17_diverse.json` | JSON | 4,288,514 B | 17 polygons | Multi-ring GeoJSON perimeters (39,875 total vertices). |

### B. Exact Recalculated Counts from Actual Records:
- **Total Ingested Observations**: **3,770**
- **Usable Supervised Observations (TRAIN + VAL + TEST)**: **2,983** (79.1%)
  - `GAS_FLARE` (Tier 2, MATCHED): **155** (5.2% of usable)
  - `WILDFIRE_CONFIRMED` (Tier 1, MATCHED): **2,828** (94.8% of usable)
- **Total Excluded Observations**: **787** (20.9%)
  - Near-boundary footprint uncertainty (`WEAK_MATCH`, Tier 3): **82** (29 Flaring + 53 Wildfire)
  - Distant regional or unassociated hotspots (`UNMATCHED`, Tier 4): **704** (109 Jamnagar + 595 Wildfire Buffer)
  - Benchmark excursion anomaly (`AMBIGUOUS`, Tier 4): **1** (`HIST-20260225-N-261`)
- **Event Group Distribution**:
  - Total unique `event_group_id` in corpus: **260**
  - Total unique `event_group_id` in usable supervised subset: **122**
  - `GAS_FLARE` unique event groups: **105** (daily stack observations over 114 days)
  - `WILDFIRE_CONFIRMED` unique event complexes: **17** (authoritative physical fire incidents)

---

## 2. Temporal Matching Audit (HIGH PRIORITY)

The Phase 5E narrative stated that wildfire observations were accepted when occurring between `attr_FireDiscoveryDateTime` and `attr_ContainmentDateTime`. Our forensic audit investigated the underlying WFIGS/IRWIN feature attributes and identified a critical semantic distinction:

### Forensic Findings on WFIGS Temporal Semantics:
1. **Cumulative Perimeter Nature**: 
   The perimeters available in the WFIGS FeatureServer represent **cumulative final or major snapshot perimeters**, NOT sub-hour fire progression lines.
   - For example, in `Cedar Creek (US-OR)`, discovery was `2022-08-01`, but the perimeter stored in WFIGS has `poly_PolygonDateTime = 2022-10-19` (127,311 cumulative acres).
   - In `Two and a Half (US-ID)`, the perimeter timestamp is `2023-06-12` (post-season administrative audit).
   - In 5 fires (`Southern`, `Smoke Stack Lightning`, `Wildhorse`, `Bottom`, `Marshall`), `poly_PolygonDateTime` is `None` in the service.
2. **Impact on Spatial Matching**:
   FIRMS detections from `2022-09-11` matched against the cumulative October 19 perimeter of Cedar Creek confirm that the observation fell inside the total fire scar, but they do NOT prove whether the specific pixel was flaming, smoldering, or unburned at that exact minute.
3. **Formal Temporal Taxonomy Reclassification**:
   - `SPATIOTEMPORALLY_MATCHED`: Strictly reserved for cases where airborne infrared progression lines (NIROPS) exist within $\pm 6	ext{ hours}$ of the satellite pass. (0 records in current corpus).
   - `TEMPORALLY_CONFIRMED` (at Incident Dispatch Level): Observations acquired during the documented uncontained active spread period between discovery and containment. (**All 2,828 wildfire records meet this standard**).
   - **Verdict**: The temporal evidence is valid as **incident-level temporal corroboration**, but must NOT be claimed as real-time active fire-front progression matching.

---

## 3. Spatial Matching Audit

The spatial matcher in `construct_training_v4_pipeline.py` implemented:
$$a = 0.5 \cdot 	ext{scan} + 0.075	ext{ km},\quad b = 0.5 \cdot 	ext{track} + 0.075	ext{ km}$$
$$	ext{Average Footprint Radius: } R_{	ext{avg}} = rac{a + b}{2}$$
$$D_{	ext{ellipse}} = rac{	ext{Distance to Polygon Boundary}}{R_{	ext{avg}}}$$

### Audit Findings:
1. **Ray-Casting Algorithm**: The point-in-polygon implementation correctly handles complex non-convex multi-ring polygons. Detections inside the perimeter were assigned $D_{	ext{ellipse}} = 0.0$ and labeled `MATCHED`.
2. **Approximation Disclaimer**: The metric uses an average radial footprint approximation rather than full elliptical orientation angle rotation. Because scan/track pixel orientation angles are not published in FIRMS standard CSV feeds, this is an **engineering footprint approximation**, not an exact sensor PSF.
3. **Threshold Consistency**:
   - `MATCHED` ($D \le 1.0$): 2,983 observations.
   - `WEAK_MATCH` ($1.0 < D \le 1.5$): 82 observations (strictly excluded).
   - `UNMATCHED` ($D > 1.5$): 704 observations (strictly excluded).
   - No numerical edge cases or coordinate conversion errors were detected.

---

## 4. Event Independence Audit

The 17 physical wildfire incidents were audited for cross-incident duplication, renaming, or overlap:

| Event Group ID | Incident Name | State | Discovery Date | GIS Acres | Event Independence Verification |
|---|---|---|---|---|---|
| `EVT-WFIGS-WF-WA-BOLT-CREEK-20220911` | Bolt Creek | WA | 2022-09-10 | 14,821 | Distinct Cascade mountain fire. |
| `EVT-WFIGS-WF-OR-CEDAR-CREEK-20220911` | Cedar Creek | OR | 2022-08-01 | 127,311 | Distinct Willamette wilderness complex. |
| `EVT-WFIGS-WF-WA-WHITNEY-20200908` | Whitney | WA | 2020-09-07 | 127,431 | Distinct Columbia Basin grass/sage fire. |
| `EVT-WFIGS-WF-CA-RIVER-20200818` | River | CA | 2020-08-16 | 48,869 | Distinct Salinas Valley / coastal range fire. |
| `EVT-WFIGS-WF-CA-COLD-SPRINGS-20200820`| W-5 Cold Springs | CA | 2020-08-18 | 84,817 | Distinct Modoc plateau lightning fire. |
| `EVT-WFIGS-WF-CA-SOUTHERN-20210502` | Southern | CA | 2021-05-01 | 5,366 | Distinct San Diego chaparral fire. |
| `EVT-WFIGS-WF-CA-MCFARLAND-20210805` | McFarland | CA | 2021-07-30 | 122,350 | Distinct Trinity county timber fire. |
| `EVT-WFIGS-WF-CA-ANTELOPE-20210806` | Antelope | CA | 2021-08-03 | 20,980 | Distinct Siskiyou county conifer fire. |
| `EVT-WFIGS-WF-TX-CANADIAN-RIVER-20220330`| Canadian River Bottom| TX | 2022-03-29 | 39,568 | Distinct Texas Panhandle prairie fire. |
| `EVT-WFIGS-WF-TX-KIDD-20220318` | Kidd | TX | 2022-03-17 | 42,333 | Part of Eastland Complex, but spatially distinct fire origin. |
| `EVT-WFIGS-WF-TX-SMOKE-STACK-20220503` | Smoke Stack Lightning| TX | 2022-05-02 | 14,898 | Distinct Stonewall county rangeland fire. |
| `EVT-WFIGS-WF-NM-HERMITS-PEAK-20220410` | Hermits Peak | NM | 2022-04-06 | 341,735 | Distinct Sangre de Cristo prescribed escape. |
| `EVT-WFIGS-WF-ID-WILDHORSE-20220905` | Wildhorse | ID | 2022-09-04 | 8,882 | Distinct Boise National Forest fire. |
| `EVT-WFIGS-WF-ID-TWO-AND-HALF-20220909` | Two and a Half | ID | 2022-09-08 | 9,251 | Distinct Bingham county rangeland fire. |
| `EVT-WFIGS-WF-AZ-BOTTOM-20210629` | Bottom | AZ | 2021-06-28 | 5,957 | Distinct Gila county desert fire. |
| `EVT-WFIGS-WF-MT-GASS-FLATS-20200924` | Gass Flats | MT | 2020-09-23 | 10,958 | Distinct Big Horn county prairie breaks fire. |
| `EVT-WFIGS-WF-CO-MARSHALL-20211230` | Marshall | CO | 2021-12-30 | 6,080 | Distinct Boulder county winter grassland fire. |

**Audit Finding**: Zero duplicate incidents or merged complexes exist in the dataset. All 17 incidents represent physically independent ignitions separated by hundreds to thousands of kilometers.

---

## 5. Class / Domain Confounding Audit (CRITICAL)

Our statistical analysis revealed severe domain confounding between the two target classes:

```
Confounding Matrix:
─────────────────────────────────────────────────────────────────────────────
Dimension             GAS_FLARE (N = 155)            WILDFIRE_CONFIRMED (N = 2,828)
─────────────────────────────────────────────────────────────────────────────
Country               100% India                     100% United States
Latitude              Mean = 22.34°N                 Mean = 43.82°N (Range 32.9°–47.8°N)
Longitude             Mean = 69.86°E                 Mean = -120.35°W (Range -123.3° to -98.8°W)
Observation Year      100% 2026 (155/155)            0% 2026 (2020: 590, 2021: 466, 2022: 1,772)
Diurnal Cycle         100% Nighttime (155/155)       81.1% Night (2,294), 18.9% Day (534)
Satellite Platform    54.2% NOAA-20, 45.8% SNPP      13.4% NOAA-20, 86.6% Suomi-NPP
```

### Risk of Trivial Non-Physical Separators:
1. **`Year == 2026`**: Yields **100% classification accuracy** without observing any radiance.
2. **`Longitude > 0`**: Yields **100% classification accuracy**.
3. **`Latitude < 30`**: Yields **100% classification accuracy**.
4. **`Satellite == 'Suomi-NPP'`**: Strongly biases toward Wildfire ($86.6\%	ext{ vs }45.8\%$).

### Audit Verdict:
**Excluding `latitude` and `longitude` is necessary but NOT SUFFICIENT on its own.**
`acq_datetime`, `year`, and facility metadata MUST also be strictly stripped from the feature tensor. Furthermore, because flaring in this baseline contains zero daytime passes, an unconstrained model could use daytime detection as a definitive indicator of Wildfire.

---

## 6. Event-Level Sample Size & Imbalance Audit

A superficial row count ($2,828	ext{ vs }155$) creates the illusion that wildfire is massively over-represented, while flaring is scarce. The event-level audit reveals the inverse:

| Metric | GAS_FLARE | WILDFIRE_CONFIRMED | Ratio / Imbalance |
|---|---|---|---|
| **Total Usable Observations** | 155 | 2,828 | 1 : 18.2 (Observation Imbalance) |
| **Unique Physical Events** | **105** | **17** | **6.2 : 1 (Event Imbalance in favor of Flaring!)** |
| **Mean Observations / Event** | 1.48 | 166.35 | — |
| **Median Observations / Event**| 1.0 | 77.0 | — |
| **Min / Max Observations / Event**| 1 / 4 | 10 / 695 | — |

### Observation Concentration in Wildfire:
- Top 1 fire (`Cedar Creek`): **695 observations** (24.6% of all wildfire data).
- Top 2 fire (`Bolt Creek`): **587 observations** (20.8% of all wildfire data).
- Top 3 fire (`Whitney`): **459 observations** (16.2% of all wildfire data).
- **The top 3 fires alone account for 1,741 observations (61.6% of all wildfire data).**

---

## 7. Split Audit & Evaluation Confounding

The group-preserved split in `construct_training_v4_pipeline.py` correctly ensured that no physical event appears in more than one partition:
- `Train / Val / Test Overlap`: **0 events**.

### Forensic Inspection of Partition Contents:
```
TRAIN Partition:
- Total Observations: 1,437 (135 Flare, 1,302 Wildfire)
- Wildfire Events (10): Bolt Creek, River, Southern, McFarland, Antelope, Canadian River, Smoke Stack Lightning, Hermits Peak, Two and a Half, Gass Flats.
- States: WA, CA, TX, NM, ID, MT.

VALIDATION Partition:
- Total Observations: 657 (15 Flare, 642 Wildfire)
- Wildfire Events (2): Whitney (WA, 459 obs), Kidd (TX, 183 obs).
- States: WA, TX.

TEST Partition:
- Total Observations: 889 (5 Flare, 884 Wildfire)
- Wildfire Events (5): Cedar Creek (OR, 695 obs), W-5 Cold Springs (CA, 25 obs), Wildhorse (ID, 38 obs), Bottom (AZ, 50 obs), Marshall (CO, 76 obs).
- States: OR, CA, ID, AZ, CO.
```

### Critical Flaw in Current Test Partition:
1. **Cedar Creek Dominance**: In the `TEST` partition, Cedar Creek alone accounts for **695 out of 889 total rows (78.2%)**! A classifier that simply predicts "Wildfire" on every test row would achieve **$99.4\%$ test accuracy** purely due to class and event imbalance.
2. **Flaring Under-representation in Test**: There are only **5 flaring observations** in the `TEST` partition. If the model misclassifies two flaring points, flaring recall drops from $100\%$ to $60\%$.
3. **Required Correction for Phase 5F**: The split must be re-partitioned to allocate more flaring events into validation/test (e.g. 60/20/25 events) and evaluation must report **Macro-Averaged F1** and **Event-Weighted Metrics**, not unweighted row accuracy.

---

## 8. Feature Leakage Audit

### Prohibited Feature Verification:
Inspected `training_candidates_v4.csv`. The following fields are present for provenance and auditing, but **MUST be blocked from entering the feature vector**:
- `latitude`, `longitude`, `geographic_region`, `ecosystem`, `fuel_model`, `season`
- `dist_to_facility`, `is_inside_facility`, `dist_to_observed_thermal_zone`
- `external_source`, `external_record_id`, `spatial_match_distance`, `temporal_match_difference`
- `label_tier`, `label_evidence_type`, `label_status`, `exclusion_reason`, `temporal_confidence`

### Permitted Physics Features:
The following 7 features are the **only permitted operational inputs**:
1. `frp` (Fire Radiative Power, MW)
2. `log_frp` ($\ln(1 + 	ext{frp})$)
3. `brightness_ti4` (3.74 μm I-4 brightness temp, K)
4. `brightness_ti5` (11.45 μm I-5 brightness temp, K)
5. `brightness_delta` ($T_{	ext{I4}} - T_{	ext{I5}}$, K)
6. `scan` (cross-track pixel size, km)
7. `track` (along-track pixel size, km)

*Note on `day_night` and `satellite`:* Because flaring in this baseline has zero daytime observations, `day_night` must be tested in a night-only ablation to ensure the model is not using nighttime as a proxy for flaring.

---

## 9. Class Definition & Taxonomy Audit

- **Current Label**: `WILDFIRE_CONFIRMED` vs `GAS_FLARE`.
- **Physical Reality**: This dataset contrasts *industrial high-temperature gas flaring* with *open wildland biomass combustion*.
- **Absence of Other Classes**: The dataset contains **zero agricultural burns** and **zero industrial structural fires**.
- **Mandatory Scientific Framing**: In Phase 5F, the experiment must be formally described as:
  > *"A controlled binary benchmark evaluating whether satellite midwave/longwave radiometric signatures ($T_{	ext{I4}}, T_{	ext{I5}}, \Delta T, 	ext{FRP}$) can physically discriminate industrial gas flaring from wildland vegetative biomass combustion in the absence of geographic metadata."*
  It must NOT be claimed as a "generalized multi-source fire classifier."

---

## 10. Label Provenance Audit

- **WFIGS**: Certified independent operational dispatch perimeters. Mapped by human wildland firefighters and airborne infrared line-scanners (NIROPS). While independent of satellite active-fire algorithms, perimeters represent cumulative burn perimeters rather than instantaneous flame-front lines.
- **EOG**: Nightfire persistent flare catalog. Uses dual-Planck curve fitting on VIIRS M-bands, physically independent of daytime I-band thresholding. However, catalog entries document multi-month operational persistence rather than real-time valve positions.
- **Terminology Rule**: Avoid terms like "100% perfect ground truth." Use **"Authoritative Independent Incident Perimeters (Tier 1)"** and **"Independent Radiometric Stack Centroids (Tier 2)"**.

---

## 11. Dataset Technical Integrity Check

- **Duplicate Rows**: 0 duplicate rows found in `training_candidates_v4.csv`.
- **Missing Values**: 0 missing values across all 33 schema fields.
- **Physical Value Bounds**:
  - `FRP`: Min = 0.0 MW, Max = 578.16 MW (Valid; zero negative or infinite values).
  - `Brightness TI4`: Min = 208.0 K, Max = 367.0 K (Valid).
  - `Brightness TI5`: Min = 255.59 K, Max = 377.53 K (Valid).
  - `Coordinates`: All latitudes $\in [-90, 90]$, longitudes $\in [-180, 180]$.
- **Format Parity**: CSV and JSON representations are byte-verified and schema-aligned.

---

## 12. Final Readiness Verdict

```
FINAL VERDICT:
[B. CONDITIONALLY READY — REQUIRED FIXES BEFORE PHASE 5F]
```

### Scientific Justification:
Phase 5E achieved genuine, commendable progress by assembling 17 authoritative physical wildfire events across 8 US states, 4 seasons, and 7 fuel regimes. The physical radiometric separation ($T_{	ext{I4}}, T_{	ext{I5}}, 	ext{FRP}$) is physically distinct and ready for experimentation.

However, an uncorrected transition to Phase 5F would be flawed because:
1. The `TEST` partition is 78.2% dominated by a single fire (`Cedar Creek`), while flaring has only 5 test observations.
2. Temporal matching against cumulative perimeters must be formally designated as `TEMPORALLY_CONFIRMED_INCIDENT_WINDOW`, not sub-hour flame-front progression.
3. Classifiers must be evaluated under strict event-weighted and night-only benchmark protocols to verify that domain shortcuts (year, daytime, satellite platform) are not driving performance.

---

## 13. Required Fixes & Exact Next Actions for Phase 5F

Before training any baseline classifier in Phase 5F, the following four engineering controls must be implemented in the training pipeline:

1. **Fix 1 — Re-partition the Test Set**:
   Rebalance the split so that `TEST` contains a balanced sample of flaring events (at least 20–25 flaring events / ~35 observations) and a representative cross-section of wildfire events (e.g. 4–5 diverse fires), rather than letting Cedar Creek monopolize 78% of test rows.
2. **Fix 2 — Mandatory Metric Protocol**:
   Prohibit unweighted overall accuracy as the success criterion. Enforce:
   - Macro-Averaged F1-Score
   - Per-Class Precision & Recall
   - Event-Level Group Accuracy (percentage of physical events whose mean predicted probability correctly identifies the source)
   - Area Under the Precision-Recall Curve (AUPRC).
3. **Fix 3 — Domain Leakage Control**:
   Strip `acq_datetime`, `year`, `geographic_region`, coordinates, and facility metadata. Implement a **Night-Only Evaluation Ablation** to prove the model does not exploit nighttime as a proxy for flaring.
4. **Fix 4 — Accurate Taxonomy Framing**:
   Report the model strictly as an *Industrial Gas Flare vs. Wildland Biomass Fire Discriminator*.

---

```
PHASE 5E AUDIT STATUS:
[VERIFICATION COMPLETE — CONDITIONALLY READY FOR CONTROLLED PHASE 5F]
```
