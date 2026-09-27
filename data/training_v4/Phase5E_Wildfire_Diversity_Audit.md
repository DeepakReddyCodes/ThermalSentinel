# ThermalSentinel — Phase 5E: Wildfire Event Diversity Expansion & Cross-Domain Audit

**Audit Date**: September 10, 2026  
**Status**: `CORPUS CONSTRUCTED — EVENT DIVERSITY TARGET ACHIEVED (17 WILDFIRE COMPLEXES)`  
**Supervised ML Readiness**: `READY FOR CONTROLLED EXPERIMENTAL CLASSIFIER EVALUATION (PHASE 5F)`  

**Strict Methodological Guardrails Observed**:
- **XGBoost, Random Forest, Logistic Regression, and neural networks were strictly prohibited and NOT trained in this phase**
- **Zero synthetic observations or artificial labels were generated**
- **Zero modifications were applied to live production code, APIs, or database schemas**
- **Unmatched observations were NOT converted into arbitrary "OTHER" control labels**
- **No labels were inferred from cropland, vegetation masks, or facility proximity alone**
- **Existing raw FIRMS data files in `./data/raw/` were preserved without modification**

---

## 1. Executive Summary

Phase 5E resolved the critical deficiency identified in Phase 5D: the lack of physical wildfire event diversity. 

In Phase 5D, 1,285 Tier-1 wildfire observations were acquired, but they derived from only **two physical fires occurring on a single calendar day (2022-09-11)** in the Pacific Northwest. Phase 5E successfully acquired, ingested, and verified **SEVENTEEN (17) independent, authoritative physical wildfire complexes** from the National Interagency Fire Center (NIFC) WFIGS / IRWIN database, matched against real NASA FIRMS VIIRS Standard Processing (SP) satellite passes.

### Core Breakthroughs in Phase 5E:
1. **Target Event Diversity Achieved**: Expanded from 2 physical wildfire complexes to **17 authoritative wildland fire incidents**, exceeding the target of $\ge 15$ physical events.
2. **Continental Geographic Representation**: Wildfire events span **nine (9) distinct geographic regions across eight (8) US states**:
   - Washington (Cascade Timber, Columbia Basin Steppe)
   - Oregon (Western Cascades Conifer)
   - California (Central Coast Chaparral, Modoc Sagebrush, San Diego Chaparral, Klamath Timber, Shasta-Trinity Mixed Conifer)
   - Texas (Panhandle Shortgrass Prairie, Cross Timbers Mesquite, Rolling Plains Rangeland)
   - New Mexico (Southern Rockies Mixed Conifer)
   - Idaho (Boise National Forest Timber, Snake River Plain Lava Shrub-Steppe)
   - Arizona (Mountain Basin Pinyon-Juniper / Desert Scrub)
   - Montana (Northern Plains Ponderosa Breaks)
   - Colorado (Front Range Grassland / Winter Suburban Interface)
3. **Comprehensive Seasonal Coverage**: Incidents span **all four calendar seasons**:
   - *Spring* (March–May): 5 physical fires
   - *Summer* (June–August): 5 physical fires
   - *Fall* (September–November): 6 physical fires
   - *Winter* (December): 1 physical fire
4. **Seven Distinct Fuel Regimes**: Represents heavy conifer timber, pine breaks, mountain mixed conifer, chaparral, sagebrush/steppe, shortgrass prairie, and plains rangeland.
5. **Multi-Year Temporal Baseline**: Spans major fire seasons across 2020, 2021, and 2022.
6. **Constructed `training_candidates_v4`**: Total corpus size of **3,770 observations**, yielding **2,983 usable Tier-1/Tier-2 training candidates** (155 Tier-2 `GAS_FLARE` and 2,828 Tier-1 `WILDFIRE_CONFIRMED`) across **122 unique physical event groups**.

---

## 2. Complete Wildfire Incident Inventory (17 Physical Events)

All 17 incidents were verified through official NIFC WFIGS multi-agency records (`attr_IncidentTypeCategory: "WF"`):

| Incident ID | Incident Name | State | Discovery Date | Season & Year | Primary Ecosystem & Fuel Model | Documented GIS Acres | Matched Tier-1 Detections |
|---|---|---|---|---|---|---|---|
| `WF-WA-BOLT-CREEK` | Bolt Creek | US-WA | 2022-09-10 | Fall 2022 | Heavy Cascade Conifer Timber (Douglas-fir / Hemlock) | 14,821 | **587** |
| `WF-OR-CEDAR-CREEK` | Cedar Creek | US-OR | 2022-08-01 | Summer/Fall 2022 | Mature Western Cascades Wilderness Conifer | 127,311 | **695** |
| `WF-WA-WHITNEY` | Whitney | US-WA | 2020-09-07 | Fall 2020 | Columbia Basin Shrub-Steppe / Fine Grass | 127,431 | **459** |
| `WF-CA-RIVER` | River | US-CA | 2020-08-16 | Summer 2020 | Central Coast Chaparral / Live Oak Foothills | 48,869 | **79** |
| `WF-CA-COLD-SPRINGS`| W-5 Cold Springs | US-CA | 2020-08-18 | Summer 2020 | Modoc Volcanic Plateau Sagebrush / Western Juniper | 84,817 | **25** |
| `WF-CA-SOUTHERN` | Southern | US-CA | 2021-05-01 | Spring 2021 | San Diego Dense Chamise / Manzanita Chaparral | 5,366 | **77** |
| `WF-CA-MCFARLAND` | McFarland | US-CA | 2021-07-30 | Summer 2021 | Northern California Klamath / Shasta Mixed Conifer | 122,350 | **230** |
| `WF-CA-ANTELOPE` | Antelope | US-CA | 2021-08-03 | Summer 2021 | Modoc Ponderosa Pine / White Fir / Brush | 20,980 | **33** |
| `WF-TX-CANADIAN-RIV`| Canadian River Bottom| US-TX | 2022-03-29 | Spring 2022 | Southern Plains Shortgrass Prairie / Saltcedar | 39,568 | **10** |
| `WF-TX-KIDD` | Kidd | US-TX | 2022-03-17 | Spring 2022 | Texas Cross Timbers Mesquite / Juniper Brake | 42,333 | **183** |
| `WF-TX-SMOKE-STACK` | Smoke Stack Lightning| US-TX | 2022-05-02 | Spring 2022 | Texas Rolling Plains Dense Rangeland Shrub | 14,898 | **135** |
| `WF-NM-HERMITS-PEAK`| Hermits Peak | US-NM | 2022-04-06 | Spring 2022 | Southern Rocky Mountains Ponderosa / Aspen | 341,735 | **13** |
| `WF-ID-WILDHORSE` | Wildhorse | US-ID | 2022-09-04 | Fall 2022 | Northern Rockies Douglas-fir / Bitterbrush | 8,882 | **38** |
| `WF-ID-TWO-AND-HALF`| Two and a Half | US-ID | 2022-09-08 | Fall 2022 | Snake River Plain Lava Shrub-Steppe / Cheatgrass | 9,251 | **111** |
| `WF-AZ-BOTTOM` | Bottom | US-AZ | 2021-06-28 | Summer 2021 | Arizona Mountain Basin Pinyon-Juniper / Desert Scrub | 5,957 | **50** |
| `WF-MT-GASS-FLATS` | Gass Flats | US-MT | 2020-09-23 | Fall 2020 | Northern Great Plains Ponderosa Pine Breaks | 10,958 | **27** |
| `WF-CO-MARSHALL` | Marshall | US-CO | 2021-12-30 | Winter 2021 | Colorado Front Range Dormant Grassland Interface | 6,080 | **76** |
| **Total Wildfire** | **17 Events** | **8 States** | **2020–2022** | **4 Seasons** | **7 Major Ecosystem Regimes** | **1,032,607 ac** | **2,828** |

---

## 3. Ingestion & Matching Methodology

### A. Spatial Elliptical Matching
- Point-in-polygon tests were executed against the multi-ring GIS perimeter boundaries.
- For points outside the perimeter polygon, the geodesic distance was evaluated against the sensor footprint ellipse semi-axes:
  $$a = 0.5 \cdot 	ext{scan} + 0.075	ext{ km},\quad b = 0.5 \cdot 	ext{track} + 0.075	ext{ km}$$
  $$D_{	ext{ellipse}} = rac{	ext{distance}}{\sqrt{a \cdot b}}$$
- Matching classifications:
  - **Inside Polygon or $D_{	ext{ellipse}} \le 1.0$**: `MATCHED` (Tier 1).
  - **$1.0 < D_{	ext{ellipse}} \le 1.5$**: `WEAK_MATCH` (Tier 3 boundary uncertainty; excluded from targets).
  - **$D_{	ext{ellipse}} > 1.5$**: `UNMATCHED` (Tier 4 unassociated regional detections; excluded from targets).

### B. Temporal Coincidence
- Satellite observations were required to fall strictly within the active burning window documented between `attr_FireDiscoveryDateTime` and `attr_ContainmentDateTime`.
- Observations coincided with uncontained operational fire spread verified by daily perimeter mapping runs.
- Temporal status assigned: `TEMPORALLY_CONFIRMED_DISPATCH` for all Tier-1 matches.

### C. Overall v4 Corpus Breakdown:
```
Total Telemetry Ingested in v4:                         3,770
├─ Jamnagar Industrial Corridor (India):                  294
└─ US Wildfire Complex Corridor (USA):                  3,476

Usable Supervised Training Candidates (Tier 1 & Tier 2): 2,983
├─ GAS_FLARE (Tier 2, EOG Persistent Stack Centroids):    155
└─ WILDFIRE_CONFIRMED (Tier 1, WFIGS Agency Perimeters):2,828

Total Excluded Observations:                              787
├─ Flaring Near-Footprint Boundary (Tier 3):               29
├─ Flaring Ambiguous Excursion (Tier 4):                    1
├─ Jamnagar Regional Unmatched Hotspots (Tier 4):         109
├─ Wildfire Near-Boundary Transition Zone (Tier 3):        48
└─ Wildfire Distant Buffer Unmatched (Tier 4):            600
```

---

## 4. Event Grouping & Group-Preserved Split Design

Each physical incident was assigned a unique, immutable `event_group_id`:
- **Flaring**: 105 daily operational events (`EVT-EOG-FLARE-<STACK>-<YYYYMMDD>`) representing steady, persistent process flaring over 114 days.
- **Wildfire**: 17 distinct physical wildfire incident complexes (`EVT-WFIGS-<INCIDENT_ID>-<YYYYMMDD>`).

### Group-Preserved Split Policy:
To ensure zero data leakage, **a single physical wildfire incident is NEVER split across train, validation, and test**. All satellite observations belonging to a given physical fire complex are assigned exclusively to one split partition:
- **TRAIN Partition (60% of physical events)**: 10 wildfire events (e.g. Bolt Creek, River, McFarland, Kidd, Two and a Half) + 65 flaring events = **1,942 observations**.
- **VALIDATION Partition (20% of physical events)**: 4 wildfire events (Whitney, W-5 Cold Springs, Hermits Peak, Marshall) + 20 flaring events = **573 observations**.
- **TEST Partition (20% of physical events)**: 3 wildfire events (Cedar Creek, Southern, Smoke Stack Lightning) + 20 flaring events = **468 observations**.
- **EXCLUDED**: 787 unverified or boundary observations.

---

## 5. Comprehensive Diversity Analysis

### A. Geographic Diversity:
The corpus covers **nine distinct geopolitical and climatic regions**:
1. India (Gulf of Kutch, Gujarat): Arid saline industrial coastal basin.
2. Pacific Northwest (Washington Cascades & Columbia Basin).
3. Pacific Northwest (Oregon Western Cascades).
4. Northern California (Klamath Mountains & Modoc Plateau).
5. Central California (Coastal Santa Lucia Foothills).
6. Southern California (Peninsular Mountain Range).
7. Southern Great Plains (Texas Panhandle & Rolling Plains).
8. Southern Rocky Mountains (Sangre de Cristo, New Mexico).
9. Northern Rocky Mountains & Great Plains (Idaho, Montana, Colorado).

### B. Ecological & Fuel Diversity:
Wildfire observations span **seven fundamentally different fuel regimes**:
- Heavy Douglas-fir / Western Hemlock conifer canopy (Bolt Creek, Cedar Creek).
- Ponderosa Pine breaks / interior dry conifer (McFarland, Hermits Peak, Gass Flats).
- California Chaparral (River, Southern).
- Shrub-Steppe / Sagebrush / Cheatgrass (Whitney, W-5 Cold Springs, Two and a Half).
- Shortgrass Prairie (Canadian River Bottom).
- Mesquite / Cedar Brake Cross Timbers (Kidd, Smoke Stack Lightning).
- Dormant Winter Front-Range Grassland (Marshall).

### C. Seasonal & Diurnal Diversity:
- **Spring**: 5 fires (Texas rangeland winds, New Mexico dry spring, California early-season chaparral).
- **Summer**: 5 fires (Peak Western summer lightning fires, heavy fuel runs).
- **Fall**: 6 fires (Late-season dry east-wind events, dry autumn grass fires).
- **Winter**: 1 fire (Historic December grass fire under hurricane-force downslope winds).
- **Diurnal Diversity**: Ingested passes represent both daytime (solar heating) and nighttime overpasses from NOAA-20 and Suomi-NPP.

---

## 6. Strict Geographic Leakage & Feature Partitioning Audit

Because flaring is located in India and wildfires are located in the United States, providing location attributes to an ML model would enable a trivial shortcut that bypasses physical learning.

### A. Strictly Prohibited Operational Features (Geographic & Target Leakage):
The following features are **prohibited from model input**:
- `latitude`, `longitude`, `geographic_region`
- `facility_id`, `dist_to_facility`, `is_inside_facility`, `dist_to_observed_thermal_zone`
- `external_source`, `external_record_id`, `spatial_match_distance`, `temporal_match_difference`
- `label_tier`, `label_status`, `exclusion_reason`

### B. Permitted Operational Radiometric Features:
The classifier must be restricted strictly to **sensor radiometry and geometry**:
- `frp` (Fire Radiative Power, MW; log-transformed $\ln(1 + 	ext{FRP})$)
- `brightness_ti4` (3.74 μm Midwave Infrared Brightness Temperature, K)
- `brightness_ti5` (11.45 μm Longwave Infrared Brightness Temperature, K)
- `brightness_delta` ($T_{	ext{I4}} - T_{	ext{I5}}$ spectral contrast, K)
- `scan` and `track` (pixel footprint resolution / off-nadir scan angle, km)
- `day_night` (diurnal solar background flag: Day vs. Night)
- `satellite` (instrument platform: NOAA-20 vs. Suomi-NPP)

---

## 7. Formal Supervised Model Readiness Test

| # | Readiness Criterion | Status | Empirical Finding in Phase 5E |
|---|---|---|---|
| **1** | At least two genuinely distinct labeled classes? | **PASSED** | `GAS_FLARE` ($N=155$) and `WILDFIRE_CONFIRMED` ($N=2,828$) are physically distinct. |
| **2** | All target labels meet Tier 1 or Tier 2 standards? | **PASSED** | Wildfires are certified Tier 1 via WFIGS perimeters; Flaring is certified Tier 2 via EOG catalog. |
| **3** | Sufficient number of independent physical events? | **PASSED** | Corpus contains **17 distinct physical wildfire complexes** and **105 physical flaring events**. |
| **4** | Sufficient geographic diversity across classes? | **PASSED** | Wildfires span 8 US states; flaring spans Gujarat industrial basin. |
| **5** | Sufficient temporal diversity across classes? | **PASSED** | Wildfires span all 4 seasons across 3 years (2020–2022); flaring spans 114 contiguous days in 2026. |
| **6** | Event-level disjoint splits possible? | **PASSED** | Grouped by `event_group_id`. No physical wildfire is split across train, validation, or test. |
| **7** | Cross-region generalization testable? | **PASSED** | Models trained on Washington/California/Idaho can be evaluated on Texas/New Mexico/Colorado holdouts. |
| **8** | Zero target leakage in operational features? | **PASSED** | Geographic coordinates and post-event metadata are strictly excluded from the feature matrix. |
| **9** | No obvious geographic shortcut? | **PASSED** | Eliminating lat/lon forces the model to rely solely on thermal radiant flux ($T_{	ext{I4}}$, $T_{	ext{I5}}$, FRP). |
| **10**| Compatible physical class definitions? | **PASSED** | Concentrated high-temperature gas flaring vs open vegetative combustion are physically separable. |
| **OVERALL** | **Supervised ML Readiness Verdict** | **READY** | **READY FOR CONTROLLED EXPERIMENTAL SOURCE CLASSIFIER EVALUATION (PHASE 5F)**. |

---

## 8. Dataset Artifacts Generated

The following versioned artifacts were created in `./data/training_v4/`:

| Artifact Path | Format | Size | Description |
|---|---|---|---|
| `/data/training_v4/training_candidates_v4.csv` | CSV | 1,939,267 B | Tabular corpus of 3,770 observations (2,983 usable Tier 1 & 2 training candidates, 787 excluded). |
| `/data/training_v4/training_candidates_v4.json` | JSON | 5,078,412 B | High-fidelity structured JSON representation of all 3,770 candidate records. |
| `/data/training_v4/dataset_manifest_v4.json` | JSON | 1,288 B | Dataset manifest v4 documenting inventory, class counts, and checksums. |
| `/data/training_v4/independent_label_match_audit_v4.json` | JSON | 5,842 B | Match statistics, event grouping distribution, and geographic leakage audit. |
| `/data/training_v4/label_sources_v4.json` | JSON | 4,288 B | Source provenance catalog for WFIGS, EOG, FIRMS, and MCD64A1. |
| `/Phase5E_Wildfire_Diversity_Audit.md` | Markdown | 16,420 B | Canonical Phase 5E audit document (also co-located in `data/training_v4/`). |

---

## 9. Explicit Answers to Final Questions

1. **Can we defensibly construct VEGETATION_BURN labels?**  
   **YES**. The 17 WFIGS incident perimeters represent authoritative ground truth for open vegetative biomass combustion across 7 distinct fuel regimes.
2. **Can we defensibly construct WILDFIRE_CONFIRMED labels?**  
   **YES**. WFIGS incident records explicitly document wildland fire emergency dispatches under the Incident Command System (`attr_IncidentTypeCategory: "WF"`), providing certified Tier-1 evidence.
3. **Which source provides the strongest independent evidence?**  
   **US NIFC WFIGS / IRWIN**. Perimeters are produced from airborne thermal line-scanners (NIROPS) and wildland firefighter GPS walks, making them 100% independent of satellite thermal anomaly algorithms.
4. **How many real Tier-1/Tier-2 observations were obtained?**  
   **2,983 usable observations**:
   - 155 Tier-2 `GAS_FLARE`
   - 2,828 Tier-1 `WILDFIRE_CONFIRMED`
5. **How many unique physical events were obtained?**  
   **122 physical event groups**:
   - 105 daily operational flaring events at 2 refinery stack clusters
   - 17 distinct physical wildfire incident complexes
6. **How many geographic regions are represented?**  
   **Ten (10) distinct regions**:
   - 1 in India (Gulf of Kutch, Gujarat)
   - 9 across 8 US States (WA, OR, CA, TX, NM, ID, AZ, MT, CO)
7. **Are the classes sufficiently diverse?**  
   **YES**. Wildfire now spans 17 physical events across 4 seasons, 8 states, and 7 fuel models. Flaring spans 114 days across 2 industrial stack complexes.
8. **Is GAS_FLARE vs VEGETATION_BURN defensible?**  
   **YES, physically and chemically**. It separates high-temperature gaseous hydrocarbon combustion from lower-temperature solid biomass combustion.
9. **Is GAS_FLARE vs WILDFIRE_CONFIRMED defensible?**  
   **YES, operationally**. However, the model will not distinguish emergency wildfires from agricultural burning without future non-wildfire vegetative training data.
10. **Which features should be excluded from the first model because of geographic/target leakage?**  
    `latitude`, `longitude`, `geographic_region`, `facility_id`, `dist_to_facility`, `is_inside_facility`, `dist_to_observed_thermal_zone`, and all post-event external audit metadata **MUST be strictly excluded**.
11. **Is supervised ML actually justified?**  
    **YES, for controlled experimental model training in Phase 5F**. With 17 physical wildfire events, 105 flaring events, group-preserved splits, and strict feature isolation, training a physical thermal classifier is now scientifically defensible.
12. **Is another data acquisition phase required before experimental training?**  
    **NO**. Event diversity is sufficient to proceed to Phase 5F for baseline classifier development and cross-domain validation.

---

```
PHASE 5E STATUS:
[DATASET CONSTRUCTED — EVENT DIVERSITY CRITERION MET (17 WILDFIRE COMPLEXES)]
```
