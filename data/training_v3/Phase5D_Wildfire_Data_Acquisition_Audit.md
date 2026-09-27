# ThermalSentinel — Phase 5D: Wildfire & Vegetation-Burn Data Acquisition & Cross-Domain Audit

**Audit Date**: September 10, 2026  
**Status**: `DATASET CONSTRUCTED — MODEL TRAINING NOT READY (EVENT DIVERSITY GAP)`  
**Supervised ML Readiness**: `NOT READY — CONTINUE DATA ACQUISITION`  

**Strict Methodological Guardrails Observed**:
- **XGBoost and supervised ML models were strictly prohibited and NOT trained**
- **Zero synthetic observations or artificial labels were generated**
- **Zero modifications were applied to live production code, APIs, or database schemas**
- **Unmatched observations were NOT converted into arbitrary "OTHER" control labels**
- **No labels were inferred from cropland, vegetation masks, or facility proximity alone**

---

## 1. Executive Summary

Phase 5D successfully acquired, verified, and integrated **real, authoritative, non-circular wildland fire incident perimeters** from the United States National Interagency Fire Center (NIFC) WFIGS / IRWIN service, along with coincident raw NASA FIRMS VIIRS I-band observations.

### Key Milestones Achieved:
1. **Live Access & Geometry Ingestion**: Verified live programmatic query access (HTTP 200) to the NIFC WFIGS Interagency Fire Perimeters ArcGIS FeatureServer. Ingested multi-ring polygon geometries (39,875 total vertices) for the **Bolt Creek Wildfire** (Washington Cascades, 14,821 acres) and the **Cedar Creek Wildfire** (Oregon Willamette National Forest, 127,311 acres).
2. **Real FIRMS Telemetry Download**: Ingested 1,337 raw NASA FIRMS active thermal observations across NOAA-20 and Suomi-NPP passes for active fire dates in September 2022.
3. **Rigorous Spatial-Temporal Matching**: Executed elliptical footprint matching against WFIGS vector perimeter boundaries. Yielded **1,285 verified Tier-1 `WILDFIRE_CONFIRMED` observations** (and 16 weak boundary exclusions, 36 unmatched buffer points).
4. **Constructed `training_candidates_v3`**: Combined the 294 Jamnagar baseline records with the 1,337 US wildfire observations to create the first multi-region, multi-class version-controlled corpus (**1,631 total observations; 1,440 usable Tier-1/Tier-2 training candidates**).
5. **Critical Scientific Finding — Event Diversity & Geographic Leakage**:
   - While 1,285 Tier-1 wildfire observations were acquired, they originate from only **TWO (2) physical wildfire events** occurring on a single calendar day in Pacific Northwest conifer forests.
   - All flaring data originates from Gujarat, India, while all wildfire data originates from the US Pacific Northwest. Including `latitude`, `longitude`, or `facility_id` in a machine learning model creates an immediate **geographic shortcut** that memorizes location rather than thermal physics.
   - **Verdict**: Training a supervised model on only 2 physical wildfire events is mathematically degenerate and prone to extreme event-level overfitting. **Model training is deferred until additional physical fire events across diverse geographic regions and fuel regimes are acquired.**

---

## 2. External Data Sources Investigated & Accessibility Audit

| Source Identifier | Source Name & Institution | Access Method & Endpoint | Access Result | Independence & Circularity Status | Role in Training |
|---|---|---|---|---|---|
| **`SRC-US-NIFC-WFIGS-2022`** | WFIGS Interagency Fire Perimeters (IRWIN) | ArcGIS FeatureServer REST API: `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query` | **HTTP 200 (VERIFIED)**. Retreived full GeoJSON polygon rings, acreage, discovery/containment dates. | **TRULY INDEPENDENT**: Mapped by incident management teams via airborne thermal line-scanners (NIROPS), GPS track walks, and ICS-209 dispatch logs. 100% independent of satellite fire detection algorithms. | **Tier 1 Ground Truth** (1,285 usable observations). |
| **`SRC-EOG-FLARE-2024`** | EOG Global Gas Flaring Catalog (v2.1) | Public download: `https://eogdata.mines.edu/download_global_flare.html` | **VERIFIED**. Geodetic flare centroids for industrial stacks. | **INDEPENDENT PHYSICAL PRODUCT**: Uses nighttime M-band dual-Planck blackbody curve fitting ($T \ge 1600	ext{ K}$). Physically distinct from daytime 375m I-band thresholding. | **Tier 2 Ground Truth** (155 usable observations). |
| **`SRC-NASA-FIRMS-VIIRS`** | NASA FIRMS VIIRS Active Fire Archive (NOAA-20 / SNPP) | REST API: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/` using configured `FIRMS_MAP_KEY` | **HTTP 200 (VERIFIED)**. Downloaded 1,337 raw active fire observations for US wildfire study corridors. | **OBSERVATIONAL TELEMETRY**: Source of radiant flux, brightness temperatures, and pixel geometry. Requires external ground truth. | **Core Observational Features**. |
| **`SRC-NASA-MCD64A1`** | NASA MODIS MCD64A1 Burned Area Product | NASA LP DAAC: `https://lpdaac.usgs.gov/products/mcd64a1v061/` | **HTTP 200 (VERIFIED)**. Monthly 500m HDF-EOS tiles. | **INDEPENDENT CORROBORATION**: Measures surface reflectance drops (charcoal deposition). Establishes vegetative biomass burned, but cannot distinguish wildfire from agricultural or prescribed burning. | **Tier 2 Corroboration Only**. |
| **`SRC-CANADA-CNFDB`** | Canadian National Fire Database | CWFIS: `https://cwfis.cfs.nrcan.gc.ca/ha/nfdb` | **HTTP 404 on direct static zip**. Requires interactive browsing on CWFIS Datamart. | **TRULY INDEPENDENT**: Agency-mapped sketch perimeters. | **Secondary Reference** (Deferred). |
| **`SRC-FSI-VAN-AGNI`** | FSI Large Forest Fire Alerts | NRSC / FSI Portal | **CIRCULAR (REJECTED)**. Reconfirmed from Phase 5C that FSI alerts are derived from MODIS/SNPP-VIIRS. | **CIRCULAR (FAILED)**. | **Disqualified**. |
| **`SRC-ICAR-CREAMS`** | ICAR-CREAMS Stubble Monitoring | ICAR Portal | **CIRCULAR (REJECTED)**. Reconfirmed from Phase 5C that CREAMS alerts are derived from MODIS/VIIRS. | **CIRCULAR (FAILED)**. | **Disqualified**. |

---

## 3. Geographic & Temporal Boundaries

The Phase 5D dataset spans two distinct continental domains:

### Domain 1: Industrial Petroleum Refining (Gujarat, India)
- **Region**: Gulf of Kutch Industrial Corridor (Jamnagar Refinery Complex).
- **Bounding Box**: Latitude $22.280^\circ	ext{N}$ to $22.410^\circ	ext{N}$, Longitude $69.750^\circ	ext{E}$ to $69.918^\circ	ext{E}$.
- **Temporal Range**: 2026-01-01 to 2026-04-25 (114 contiguous calendar days).
- **Terrain / Land Use**: Industrial refinery stacks, marine buffer, arid saline soils.

### Domain 2: Pacific Northwest Temperate Conifer Wildfires (United States)
- **Region 2A (Washington Cascades)**:
  - *Fire Incident*: **Bolt Creek Wildfire** (`poly_IncidentName: Bolt Creek`, `attr_POOState: US-WA`).
  - *Coordinates*: Latitude $47.74^\circ	ext{N}$ to $47.82^\circ	ext{N}$, Longitude $-121.45^\circ	ext{W}$ to $-121.28^\circ	ext{W}$.
  - *Acreage*: 14,821 GIS acres across King and Snohomish Counties.
  - *Terrain / Fuel*: Dense mature Douglas fir, western hemlock, steep mountainous terrain.
  - *Observation Date*: 2022-09-11 (Active uncontrolled wildfire spread 24 hours post-discovery).
- **Region 2B (Oregon Willamette National Forest)**:
  - *Fire Incident*: **Cedar Creek Wildfire** (`poly_IncidentName: Cedar Creek`, `attr_POOState: US-OR`).
  - *Coordinates*: Latitude $43.60^\circ	ext{N}$ to $43.85^\circ	ext{N}$, Longitude $-122.35^\circ	ext{W}$ to $-121.95^\circ	ext{W}$.
  - *Acreage*: 127,311 GIS acres across Lane County.
  - *Terrain / Fuel*: Western Cascades wilderness conifer forest.
  - *Observation Date*: 2022-09-11 (Active uncontained wildfire spread).

---

## 4. Spatiotemporal Matching Methodology & Results

### Spatial Elliptical Matching:
For each FIRMS detection, the distance to the multi-ring WFIGS perimeter boundary was evaluated against the sensor footprint ellipse semi-axes ($a = 0.5 \cdot 	ext{scan} + 0.075	ext{ km}$, $b = 0.5 \cdot 	ext{track} + 0.075	ext{ km}$):
- **Inside Polygon or $D_{	ext{ellipse}} \le 1.0$**: `MATCHED` (Tier 1).
- **$1.0 < D_{	ext{ellipse}} \le 1.5$**: `WEAK_MATCH` (Tier 3 near-boundary uncertainty; excluded from targets).
- **$D_{	ext{ellipse}} > 1.5$**: `UNMATCHED` (Tier 4 outside perimeter; excluded from targets).

### Temporal Coincidence Rules:
- **Bolt Creek**: Ignition discovered 2022-09-10 14:35 UTC. Contained October 2022. Satellite passes on 2022-09-11 occurred during active, uncontained fire growth under east-wind conditions. Status: `TEMPORALLY_CONFIRMED_DISPATCH`.
- **Cedar Creek**: Ignition discovered 2022-08-01 16:39 UTC. Contained October 2022. Passes on 2022-09-11 occurred during rapid run. Status: `TEMPORALLY_CONFIRMED_DISPATCH`.

### Ingestion & Matching Summary:

| Dataset File | Target Incident | Sensor Pass | Raw Observations | MATCHED (Tier 1) | WEAK_MATCH (Tier 3) | UNMATCHED (Tier 4) |
|---|---|---|---|---|---|---|
| `US-WA-BOLT-CREEK_VIIRS_NOAA20_SP_2022-09-11_raw.csv` | Bolt Creek | NOAA-20 | 294 | **277** | 4 | 13 |
| `US-WA-BOLT-CREEK_VIIRS_SNPP_SP_2022-09-11_raw.csv` | Bolt Creek | Suomi-NPP | 322 | **310** | 2 | 10 |
| `US-OR-CEDAR-CREEK_VIIRS_NOAA20_SP_2022-09-11_raw.csv` | Cedar Creek | NOAA-20 | 106 | **102** | 1 | 3 |
| `US-OR-CEDAR-CREEK_VIIRS_SNPP_SP_2022-09-11_raw.csv` | Cedar Creek | Suomi-NPP | 615 | **596** | 9 | 10 |
| **US Wildfire Subtotal** | | | **1,337** | **1,285** | **16** | **36** |
| **Jamnagar Flaring Subtotal (from v1)** | Jamnagar Stacks | NOAA-20 / SNPP | **294** | **155 (Tier 2)** | **29** | **110** |
| **Total v3 Training Corpus** | | | **1,631** | **1,440 (Tier 1+2)** | **45** | **146** |

---

## 5. Event Grouping & Deduplication Audit

To prevent multiple satellite detections from being treated as independent physical occurrences, `event_group_id` was strictly maintained:

```
Physical Event Breakdown:
───────────────────────────────────────────────────────────────────────
1. GAS_FLARE (Jamnagar):
   - Total usable observations: 155
   - Unique physical event groups: 105 (stack centroid × daily observation pass)
   - Observations per event: 1.48

2. WILDFIRE_CONFIRMED (US Pacific Northwest):
   - Total usable observations: 1,285
   - Unique physical incident complexes: 2
     * EVT-WFIGS-US-WA-BOLT-CREEK-20220911: 587 observations
     * EVT-WFIGS-US-OR-CEDAR-CREEK-20220911: 698 observations
   - Observations per event: 642.5
```

**Critical Scientific Insight**: Although wildfire observations outnumber flaring observations ($1,285	ext{ vs }155$), **flaring possesses 105 independent daily operational events, whereas wildfire possesses only TWO (2) physical wildfire incidents on a single day.**

---

## 6. Geographic Leakage & Target Confounding Audit

An audit was conducted to determine whether an ML model would learn physical combustion characteristics or merely memorize geographic shortcuts:

### Severe Confounding Identified:
- All `GAS_FLARE` observations are located at:
  $$	ext{Latitude} pprox 22.3^\circ	ext{N},\quad 	ext{Longitude} pprox 69.8^\circ	ext{E}$$
- All `WILDFIRE_CONFIRMED` observations are located at:
  $$	ext{Latitude} \in [43.6^\circ	ext{N}, 47.8^\circ	ext{N}],\quad 	ext{Longitude} \in [-122.4^\circ	ext{W}, -121.2^\circ	ext{W}]$$
- If `latitude`, `longitude`, `geographic_region`, `facility_id`, or `dist_to_facility` are provided to an XGBoost model, the tree will place a single split:
  $$	ext{if Latitude} > 35.0^\circ	ext{N} \implies 	ext{WILDFIRE else GAS\_FLARE}$$
  This would achieve **100% training and validation accuracy** while learning **zero physics**. The model would immediately fail if presented with gas flaring in the North Sea ($	ext{lat} pprox 56^\circ	ext{N}$) or a forest fire in Madhya Pradesh, India ($	ext{lat} pprox 22^\circ	ext{N}$).

### Mandatory Feature Partitioning Policy:

#### A. Strictly Prohibited from Inference Inputs (Geographic / Target Leakage):
- `latitude`, `longitude`, `geographic_region`
- `facility_id`, `dist_to_facility`, `is_inside_facility`, `dist_to_observed_thermal_zone`
- `external_source`, `external_record_id`, `spatial_match_distance`, `temporal_match_difference`
- `label_tier`, `label_status`, `exclusion_reason`

#### B. Strictly Permitted Operational Features (Radiometric & Sensor Geometry Physics Only):
- `frp` (Fire Radiative Power, MW; log-transformed)
- `brightness_ti4` (3.74 μm Midwave Infrared Brightness Temperature, K)
- `brightness_ti5` (11.45 μm Longwave Infrared Brightness Temperature, K)
- `brightness_delta` ($T_{	ext{I4}} - T_{	ext{I5}}$ spectral contrast, K)
- `scan` and `track` (pixel footprint resolution / scan angle, km)
- `day_night` (diurnal solar illumination flag)
- `satellite` (instrument platform: NOAA-20 vs Suomi-NPP)
- `confidence` (nominal vs high detection confidence)

---

## 7. Taxonomy Assessment: `WILDFIRE` vs. `VEGETATION_BURN`

### Option A: `GAS_FLARE` vs. `VEGETATION_BURN`
- *Physical Basis*: Distinguishes point-source, high-temperature gaseous hydrocarbon combustion ($T \ge 1600	ext{ K}$) from open-air combustion of solid vegetative biomass (cellulose, hemicellulose, lignin; $T pprox 800-1200	ext{ K}$).
- *Scientific Defensibility*: **HIGH**. Independent of human legal intent, property boundaries, or administrative dispatch. A satellite sensor observes radiant emissions from combusting biomass, making `VEGETATION_BURN` a physically honest classification target.

### Option B: `GAS_FLARE` vs. `WILDFIRE_CONFIRMED`
- *Physical Basis*: Distinguishes industrial flaring from documented wildland fire emergency incidents.
- *Scientific Defensibility*: **CONDITIONALLY DEFENSIBLE**. WFIGS records explicitly document Incident Command System wildfire dispatches (`attr_IncidentTypeCategory: "WF"`). Therefore, WFIGS-matched detections meet the strict threshold for `WILDFIRE_CONFIRMED`. However, without non-wildfire vegetative burns (e.g., agricultural residue, prescribed burns) in the training corpus, the model cannot distinguish an emergency wildfire from a routine crop burn.

---

## 8. Formal Supervised Model Readiness Test

We evaluated the 10 formal prerequisites required before supervised training can be justified:

| # | Readiness Criterion | Status | Empirical Finding |
|---|---|---|---|
| **1** | At least two genuinely distinct labeled classes exist? | **PASSED** | `GAS_FLARE` ($N=155$) and `WILDFIRE_CONFIRMED` ($N=1,285$) are physically and semantically distinct. |
| **2** | All target labels meet Tier 1 or Tier 2 standards? | **PASSED** | WFIGS is certified Tier 1; EOG flaring catalog is certified Tier 2. |
| **3** | Sufficient number of independent physical events? | **FAILED** | Flaring has 105 physical events, but wildfire has only **TWO (2) physical fire complexes**. |
| **4** | Sufficient geographic diversity across classes? | **FAILED** | Flaring is 100% in India; wildfire is 100% in US Pacific Northwest. Geographic confounding is extreme. |
| **5** | Sufficient temporal diversity across classes? | **FAILED** | All 1,285 wildfire observations derive from a **single calendar day** (2022-09-11). |
| **6** | Event-level disjoint splits possible? | **PASSED** | Grouping by `event_group_id` prevents observation leakage across splits. |
| **7** | Cross-region evaluation possible? | **CONDITIONALLY POSSIBLE** | Model can be evaluated across regions, but domain shift is conflated with class shift. |
| **8** | Zero target leakage in operational features? | **PASSED** | Post-event metadata and coordinates are strictly excluded from operational features. |
| **9** | No obvious geographic shortcut? | **CONDITIONALLY PASSED** | Requires total exclusion of lat/lon and facility features; otherwise fails immediately. |
| **10** | Compatible class definitions? | **PASSED** | Industrial gas flaring vs wildland vegetative combustion are physically compatible targets. |
| **OVERALL** | **Supervised ML Readiness Verdict** | **FAILED** | **NOT READY — CONTINUE DATA ACQUISITION**. |

---

## 9. Dataset Artifacts Generated

The following versioned artifacts were created in `./data/training_v3/`:

| Artifact Path | Format | Size | Description |
|---|---|---|---|
| `/data/training_v3/training_candidates_v3.csv` | CSV | 811,408 B | Full tabular corpus of 1,631 observations (1,440 usable Tier-1/Tier-2 training candidates, 191 excluded). |
| `/data/training_v3/training_candidates_v3.json` | JSON | 2,089,595 B | High-fidelity structured JSON representation of all 1,631 candidate records. |
| `/data/training_v3/dataset_manifest_v3.json` | JSON | 1,197 B | Dataset manifest v3 recording inventory, class counts, and checksums. |
| `/data/training_v3/independent_label_match_audit_v3.json` | JSON | 2,961 B | Match statistics, event grouping distribution, and geographic leakage audit. |
| `/data/training_v3/label_sources_v3.json` | JSON | 4,199 B | Source provenance catalog for WFIGS, EOG, FIRMS, MCD64A1, and CNFDB. |
| `/Phase5D_Wildfire_Data_Acquisition_Audit.md` | Markdown | ~15 KB | Canonical Phase 5D audit document. |

---

## 10. Answers to Final User Questions

1. **Can we defensibly construct VEGETATION_BURN labels?**  
   **YES**. WFIGS incident perimeters and NASA MCD64A1 burned area products provide physically grounded, non-circular evidence of vegetative biomass combustion.
2. **Can we defensibly construct WILDFIRE_CONFIRMED labels?**  
   **YES**. WFIGS incident perimeters explicitly document incident command wildland fire dispatches, providing certified Tier-1 evidence for `WILDFIRE_CONFIRMED`.
3. **Which source provides the strongest independent evidence?**  
   **US NIFC WFIGS / IRWIN**. Perimeters are produced from airborne thermal line-scanners (NIROPS) and wildland firefighter GPS walks, making them 100% independent of satellite thermal algorithms.
4. **How many real Tier-1/Tier-2 observations were obtained?**  
   **1,440 usable observations**:
   - 155 Tier-2 `GAS_FLARE`
   - 1,285 Tier-1 `WILDFIRE_CONFIRMED`
5. **How many unique physical events were obtained?**  
   **107 physical event groups**:
   - 105 daily flaring events at 2 refinery stack clusters
   - 2 major wildfire complexes (Bolt Creek, WA and Cedar Creek, OR)
6. **How many geographic regions are represented?**  
   **Three (3) distinct regions**:
   - Gulf of Kutch Industrial Corridor, Gujarat, India
   - Cascade Mountain Range, Washington State, USA
   - Willamette National Forest, Western Cascades, Oregon, USA
7. **Are the classes sufficiently diverse?**  
   **NO**. While flaring has strong temporal diversity (114 days), wildfire has **critical event-diversity deficiency**: 1,285 observations originate from only 2 physical fires on a single calendar day (2022-09-11).
8. **Is GAS_FLARE vs VEGETATION_BURN defensible?**  
   **YES, conceptually and physically**. It separates point-source high-temperature gas flaring from open-air biomass combustion.
9. **Is GAS_FLARE vs WILDFIRE_CONFIRMED defensible?**  
   **YES, operationally**. However, it cannot distinguish an emergency wildfire from an agricultural burn without non-wildfire biomass training examples.
10. **Which features should be excluded from the first model because of geographic/target leakage?**  
    `latitude`, `longitude`, `geographic_region`, `facility_id`, `dist_to_facility`, `is_inside_facility`, `dist_to_observed_thermal_zone`, and all post-event external audit metadata **MUST be strictly excluded**.
11. **Is supervised ML actually justified?**  
    **NO. Supervised ML is NOT YET JUSTIFIED.**
12. **If not, what exact data is still missing?**  
    **Wildfire physical event diversity across multiple fire regimes and seasons**. Training requires at least 15–30 independent physical wildfire events spanning different ecosystems (e.g., California chaparral, Great Plains grasslands, Texas rangelands) to prevent the model from memorizing the specific atmospheric and fuel characteristics of September 11, 2022 in the Pacific Northwest.

---

```
PHASE 5D STATUS:
[DATASET CONSTRUCTED — MODEL TRAINING NOT READY (EVENT DIVERSITY GAP)]
```
