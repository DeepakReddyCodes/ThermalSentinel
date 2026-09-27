# ThermalSentinel — Reality Check & Architectural Data Path Audit

**Date**: 2026-09-11  
**Project**: ThermalSentinel — Operational Satellite Thermal Intelligence System  
**Evaluation Scope**: Forensic Inspection of Prototype Runtime Data Paths  
**Objective**: Identify the genuine runtime data source for all 14 core components before the final prototype push.  
**Constraint**: NO code was modified during this audit.

---

## Executive Summary

ThermalSentinel was subjected to a line-by-line runtime and architectural audit. 

The central finding of this reality check is:
**The core analytical, geospatial, and reasoning pipeline is overwhelmingly REAL and ALGORITHMICALLY COMPUTED FROM REAL SATELLITE DATA.** 
Out of 14 key components:
- **1 is REAL LIVE DATA** (NASA FIRMS open near-real-time satellite feeds, actively returning 500+ live South Asia detections).
- **1 is REAL LOCAL DATA** (294 real historical VIIRS satellite passes in Jamnagar; 1,234 partitioned historical records in `training_v4`).
- **8 are REAL COMPUTED FROM REAL DATA** (Spatial ray-casting, Empirical facility baseline quantiles, Anomaly classification, Contextual hypothesis scoring, Shannon entropy calculation, NBE information-value ranking, Standardized logistic regression inference, and Investigation dossier compilation).
- **2 are STATIC / MOCK** (Facility polygons are hand-authored approximations rather than live Overpass OSM queries; Sentinel-2 evidence uses static findings and simulated RGB/SWIR hex indicators without a live raster pipeline).
- **1 is SIMULATED** (Sentinel-2 multi-spectral image findings and band parameters).
- **1 is NOT IMPLEMENTED / INACTIVE AT RUNTIME** (Supabase: `.env` has an invalid/paused host that fails DNS resolution, and `server.ts` does not load `dotenv`; the entire application runs on the local file-backed JSON store).

---

## Component-by-Component Reality Audit

### 1. NASA FIRMS Ingestion
- **Classification**: **REAL LIVE DATA** (with REAL LOCAL DATA fallback)
- **Runtime Code Path**:
  - Backend: `server/firms.ts` -> `fetchLiveFirmsObservations()` -> `server.ts` (`GET /api/firms/observations`)
  - Frontend: `src/services/firmsService.ts` -> `fetchRealTimeFirmsFromBackend()`
- **Live API Endpoint & Fallback Chain**:
  1. *Primary REST API*: `https://firms.modaps.eosdis.nasa.gov/api/country/csv/${apiKey}/${source}/${country}/${dayRange}` (Attempted if `FIRMS_MAP_KEY` is present in process environment).
  2. *Secondary Open NRT Feed*: `https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_24h.csv` (Open 24-hour South Asia broadcast feed; **verified active and returned 548 live satellite detections during runtime inspection**).
  3. *Tertiary Offline Cache*: `data/processed/FAC-GUJ-JAMNAGAR-01_historical_observations.json` (Transparently loads with `data_mode: 'LOCAL_BENCHMARK_CACHE'` if network or remote feeds fail).
- **Reality Determination**: Genuine live satellite data ingestion from NASA Goddard Space Flight Center.

---

### 2. FIRMS Historical Archive
- **Classification**: **REAL LOCAL DATA**
- **Runtime Code Path**:
  - `data/processed/FAC-GUJ-JAMNAGAR-01_historical_observations.json` (294 real historical VIIRS observations from 2026-01-01 to 2026-04-25, complete with raw satellite line payloads).
  - `data/training_v4/` (1,234 partitioned, audited historical fire/flare records across India).
  - Loaded via `server/historicalIngestion.ts` and `server/investigationEngine.ts` (`getInvestigationQueue()`).
- **Reality Determination**: Real historical VIIRS records acquired from NASA FIRMS and stored as local persistent JSON datasets. No synthetic rows.

---

### 3. OSM Facility Geometry
- **Classification**: **STATIC / MOCK**
- **Runtime Code Path**:
  - Backend: `server/facilities.ts` (`MONITORED_FACILITIES`)
  - Frontend: `src/data/facilities.ts` (`MONITORED_FACILITIES`)
- **Origin & Semantics**:
  - Geometries are **hand-authored static arrays** of 4-to-5 polygon coordinates bounding real industrial complexes (e.g., Jamnagar `[22.3598, 69.8642]`).
  - Known thermal zones (e.g. `ZONE-JAM-01`, Elevated Flares A1-A4) are hand-configured coordinate points.
  - **There is NO live connection to OpenStreetMap (OSM) or the Overpass API.** No `.osm` or `.pbf` files exist in the repository.
- **Reality Determination**: Locally authored geometric approximation of real facility boundaries.

---

### 4. Facility Association
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - `server/geospatial.ts` -> `associateObservationWithFacilities()`, `isPointInPolygon()`, `haversineDistanceMeters()`
- **Algorithm**:
  - Executes a standard ray-casting point-in-polygon algorithm against the facility polygon vertices.
  - Computes exact spherical Haversine geodesic distances in meters to the facility centroid, buffer perimeter, and known thermal zones.
  - Classifies observations dynamically into `KNOWN_THERMAL_ZONE`, `FACILITY_OFF_ZONE`, `FACILITY_BUFFER`, or `UNASSOCIATED`.
- **Reality Determination**: Real mathematical geometry calculation executed dynamically on real observation coordinates.

---

### 5. Historical Facility Baseline
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - Ingestion & Calculation: `server/historicalIngestion.ts` -> `calculateEmpiricalBaseline()`
  - Persistence & Access: `data/processed/FAC-GUJ-JAMNAGAR-01_baseline.json` -> `server/baselineRepository.ts` -> `getFacilityBaseline()`
- **Mathematical Computation**:
  - Ingested 213 historical VIIRS detections in the Jan 1 – Apr 25 baseline window.
  - Calculated exact empirical quantiles: Median ($2.22\text{ MW}$), P25 ($1.72\text{ MW}$), P75 ($2.85\text{ MW}$), P90 ($3.44\text{ MW}$), P95 ($3.93\text{ MW}$), Max ($7.82\text{ MW}$), and Median Absolute Deviation ($\text{MAD} = 0.58\text{ MW}$).
  - Computed diurnal distributions ($100\%$ nocturnal) and 24-hour frequency bins.
  - Facilities with $<30$ historical observations return `INSUFFICIENT_DATA`.
- **Reality Determination**: Genuinely computed statistical baseline derived from real NASA VIIRS satellite passes.

---

### 6. Anomaly Calculation
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - `server/deviationEngine.ts` -> `evaluateObservationAgainstBaseline()`
- **Algorithm**:
  - Compares observation FRP against the empirical quantiles.
  - Threshold rules:
    - $\text{FRP} > \text{P95}$ or $\text{FACILITY\_OFF\_ZONE} \to \text{ANOMALOUS}$
    - $\text{FRP} > \text{P75} \to \text{ELEVATED}$
    - $\text{FRP} \le \text{P75}$ within known zone $\to \text{NORMAL}$
  - Calculates exact ratios ($\text{ratio} = 5.39\times$) and FRP deltas ($+9.75\text{ MW}$).
- **Reality Determination**: Real mathematical deviation model operating on real observation radiometry and real baseline quantiles.

---

### 7. Source Hypotheses
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - `server/investigationEngine.ts` -> `calculateSourceHypothesesAndUncertainty()`
- **Algorithm**:
  - Multi-attribute contextual scoring model combining spatial containment, distance to flare clusters, baseline quantile exceedance, diurnal timing, and detection confidence.
  - Normalizes raw accumulated scores across 5 hypothesis classes (`GAS_FLARE`, `INDUSTRIAL_FIRE`, `AGRICULTURAL_BURN`, `WILDFIRE_VEGETATION`, `OTHER`).
  - Transparently generates written rationales per class.
  - *Note*: This is a rule-based expert heuristic engine (designated as "Prototype Contextual Assessment"), not a trained neural network.
- **Reality Determination**: Real computational heuristic model executed on real satellite and geospatial variables.

---

### 8. Shannon Entropy
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - `server/investigationEngine.ts` -> `calculateShannonEntropy()`
  - `src/services/evidenceEngine.ts` -> `calculateEntropy()`
- **Algorithm**:
  - Direct implementation of Shannon's information theory equation:
    $$H(X) = - \sum_{i=1}^K p_i \log_2(p_i)$$
  - Evaluates maximum possible entropy $H_{\text{max}} = \log_2(K)$ (2.322 bits for 5 classes) and normalized entropy ratio $H / H_{\text{max}}$.
  - Recomputes dynamically when new evidence modifies hypothesis probabilities.
- **Reality Determination**: Exact mathematical information-theoretic calculation.

---

### 9. Sentinel-2 Evidence
- **Classification**: **SIMULATED / STATIC**
- **Runtime Code Path**:
  - Definition: `src/data/evidenceLibrary.ts` (`EVIDENCE_CATALOG['FIRMS-20260901-4821']`, `EVIDENCE_CATALOG['HIST-20260225-N-261']`)
  - Types: `src/types/index.ts` (`EvidenceItem`, `simulatedBands`, `evidenceFindings`)
  - Display: `src/components/InvestigationEngine.tsx` (Candidate Evaluation Matrix)
- **Detailed Forensic Findings**:
  - **No Live API**: There is zero code connecting to Copernicus Data Space Ecosystem, Sentinel Hub, or ESA STAC API.
  - **No Image Files**: The repository contains **zero** image files (`.tif`, `.png`, `.jpg`).
  - **Simulated Bands**: The code stores static hex color codes:
    ```typescript
    simulatedBands: {
      swir22: '#ef4444',
      nir: '#f97316',
      trueColor: '#475569',
    }
    ```
  - **Static Findings**: Normalized Burn Ratio ($\text{NBR} = -0.42$) and pixel footprint ($4,200\text{ m}^2$) are static hand-authored mockup values.
  - **NBE Status**: In the Investigation Engine Section 7, Sentinel-2 SWIR is explicitly designated as `availabilityStatus: 'NOT_CURRENTLY_AVAILABLE'` with notes stating *"Subject to satellite revisit latency"*.
  - **Interactive Application**: In `InvestigationEngine.tsx`, the prop `onApplyEvidenceToCase` is declared on line 43 but is **never invoked** inside the component; evidence items cannot be interactively applied from the current Investigation UI without an explicit trigger button.
- **Reality Determination**: Purely simulated metadata and static mockup parameters. No real Sentinel-2 raster data exists in the prototype.

---

### 10. Next-Best-Evidence (NBE) Ranking
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - `server/investigationEngine.ts` -> `evaluateEvidenceGuidedInvestigation()`
- **Algorithm**:
  - Implements the audited information-value utility formula:
    $$\text{UtilityScore}(E) = \text{round}\left(100 \times \left[0.30 \times \frac{H}{H_{\text{max}}} + 0.25 \times C_{\text{comp}} + 0.45 \times \text{Relevance}(E, \text{case})\right] \times \text{CostMultiplier}(E)\right)$$
  - Dynamically calculates hypothesis competition $C_{\text{comp}} = \max(0, 1 - |p_1 - p_2|/100)$ from the live hypothesis distribution.
  - Dynamically applies cost multipliers (1.0 for connected data, 0.78 for satellite revisit latency, 0.45 for plant SCADA).
  - Evaluates 10 candidate sources and dynamically ranks the top available and top external candidates.
- **Reality Determination**: Real dynamic mathematical ranking algorithm evaluated against live case metrics.

---

### 11. ML Discriminator
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - Backend: `server/thermalDiscriminator.ts` -> `evaluateThermalDiscriminator()`
  - Frontend: `src/services/thermalDiscriminator.ts` -> `evaluateThermalDiscriminator()`
- **Implementation**:
  - Implements the audited Phase 5F.3 Standardized Logistic Regression model.
  - Hardcoded model parameters: intercept $w_0 = +7.521435$, 7 standardized weights, StandardScaler mean $\boldsymbol{\mu}$ and std $\boldsymbol{\sigma}$.
  - Extracts 7 real radiometric features from the satellite observation: $\ln(1+\text{frp})$, $T_{\text{I4}}$, $T_{\text{I5}}$, $\Delta T$, $\text{scan}$, $\text{track}$, $\text{is\_day}$.
  - Computes standardized dot product and logistic sigmoid function $1 / (1 + e^{-z})$.
  - Strictly isolated as an auxiliary advisory layer.
- **Reality Determination**: Real statistical ML inference executing trained coefficients on real satellite radiometric inputs.

---

### 12. Supabase
- **Classification**: **NOT IMPLEMENTED / INACTIVE AT RUNTIME** (File-backed local store active)
- **Runtime Code Path**:
  - `server/db.ts` -> `getDbPool()`, `initDatabaseSchema()`
- **Detailed Forensic Findings**:
  - **Unconfigured at Startup**: `server.ts` does not import `dotenv/config`. When `node dist/server.cjs` runs, `process.env.DATABASE_URL` is undefined, and the health check reports:
    `database: { status: 'UNCONFIGURED', message: 'DATABASE_URL is not set. Data is processed in-memory directly from NASA FIRMS feeds.', postgis_enabled: false }`.
  - **DNS Failure**: Testing the `.env` database URL directly (`db.kunaltrcztwouuynoolv.supabase.co`) reveals that the DNS hostname does not resolve (`[Errno 11001] getaddrinfo failed`). The remote Supabase project is either paused, deleted, or misconfigured.
  - **File-Backed Fallback**: In `server/baselineRepository.ts` and `server/historicalIngestion.ts`, all database queries are secondary to local JSON reads from `data/processed/`.
- **Reality Determination**: Supabase is completely inactive. ThermalSentinel operates 100% on a local JSON file-backed persistence layer.

---

### 13. Investigation Priority
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - `server/investigationEngine.ts` -> `calculateInvestigationPriorityScore()`
- **Algorithm**:
  - Rule-based multi-factor scoring function:
    - Base: $\text{ANOMALOUS} = 65$, $\text{ELEVATED} = 40$, $\text{NORMAL} = 15$
    - Off-zone inside facility: $+15$
    - FRP exceedance of P95: $+15$
    - Hypothesis ambiguity ($C_{\text{comp}} \ge 0.70$): $+10$
    - Critical infrastructure category (refinery): $+10$
    - Clamped to $[0, 100]$. Level: $\ge 70 \to \text{HIGH}$, $45-69 \to \text{MEDIUM}$, $<45 \to \text{LOW}$.
- **Reality Determination**: Real deterministic triage algorithm calculated from real observation features and baseline deviation.

---

### 14. Investigation Dossier
- **Classification**: **REAL COMPUTED FROM REAL DATA**
- **Runtime Code Path**:
  - Assembled in `server/investigationEngine.ts` -> `buildInvestigationCase()`
  - Exported in `src/components/InvestigationEngine.tsx` -> `handleExportDossier()`
- **Content**:
  - Dynamically packages observation metadata, facility geometry, baseline metrics, behavioural deviation, 5-class hypothesis distribution, Shannon entropy, NBE candidate rankings, and advisory ML discriminator scores into a structured JSON dossier downloaded by the user.
- **Reality Determination**: Real dynamic aggregation and export of all upstream analytical layers.

---

## Reality Scorecard

| # | Feature / Component | Current Source | Real / Mock Classification | Effort to Make Real | Implementation Priority | Recommended Action |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **NASA FIRMS Ingestion** | NASA Open NRT 24h CSV feed (`server/firms.ts`) | **REAL LIVE DATA** | *Already Real* (<15 min to wire `.env` REST key) | **LOW** (Already working live) | Maintain current dual-feed architecture; optionally add `import 'dotenv/config'` to `server.ts`. |
| **2** | **FIRMS Historical Archive** | Real VIIRS JSONs (`data/processed/`, `data/training_v4/`) | **REAL LOCAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing verified historical cache. |
| **3** | **OSM Facility Geometry** | Hardcoded coordinate polygons (`server/facilities.ts`) | **STATIC / MOCK** | **15–30 min** | **MEDIUM** | Query Overpass API for Jamnagar industrial boundary and save genuine OSM GeoJSON. |
| **4** | **Facility Association** | Ray-casting & Haversine geodesic math (`server/geospatial.ts`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing verified mathematical implementation. |
| **5** | **Historical Facility Baseline** | Quantile engine over 213 VIIRS passes (`server/historicalIngestion.ts`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing verified statistical implementation. |
| **6** | **Anomaly Calculation** | Quantile exceedance rules (`server/deviationEngine.ts`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing verified deviation engine. |
| **7** | **Source Hypotheses** | Multi-factor contextual heuristic model (`server/investigationEngine.ts`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing transparent heuristic scoring. |
| **8** | **Shannon Entropy** | $H = -\sum p_i \log_2(p_i)$ (`server/investigationEngine.ts`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing exact information-theoretic formula. |
| **9** | **Sentinel-2 Evidence** | Static findings & simulated hex bands (`evidenceLibrary.ts`) | **SIMULATED / STATIC** | **30–60 min** (Static real tile) / **>60 min** (Live Copernicus API) | **HIGH** | Acquire 1 real Sentinel-2 SWIR/True-color image crop for Jamnagar, display in drawer with real metadata. |
| **10** | **NBE Ranking** | Information-value utility formula (`server/investigationEngine.ts`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing verified ranking engine. |
| **11** | **ML Discriminator** | Logistic Regression on 7 VIIRS features (`server/thermalDiscriminator.ts`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing audited Phase 5F.3 advisory model. |
| **12** | **Supabase** | File-backed JSON (`server/db.ts` inactive, DNS failed) | **NOT IMPLEMENTED** | **15–30 min** (If active DB provided) / **>60 min** (If repairing Supabase) | **LOW** | **DO NOT TOUCH**. Local file-backed storage is fast, reliable, and 100% offline-resilient for the presentation. |
| **13** | **Investigation Priority** | Multi-factor operational triage score (`server/investigationEngine.ts`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing verified triage scoring. |
| **14** | **Investigation Dossier** | Dynamic JSON serialization (`InvestigationEngine.tsx`) | **REAL COMPUTED FROM REAL DATA** | *Already Real* | **NONE** (Complete) | Keep existing export functionality. |

---

## High-ROI Recommendations for Final 3–4 Hours

Based on the scorecard, **10 out of 14 components are already genuine and functional**. To maximize demonstrable reality within the remaining 3–4 hours without risking system stability:

1. **Quick Win 1: Enable NASA REST Key (<15 min)**
   - Add `import 'dotenv/config';` to `server.ts` so the verified `FIRMS_MAP_KEY` in `.env` is loaded by default, upgrading the server health check from `NASA_OPEN_NRT_FEED` to `NASA_REST_API`.
2. **Quick Win 2: Replace Hand-Authored Geometry with Genuine OSM GeoJSON (15–30 min)**
   - Run a 1-shot script querying Overpass API for Jamnagar (`way["landuse"="industrial"]` or `relation["operator"="Reliance Industries Limited"]`), convert to GeoJSON, and load into `server/facilities.ts` to make OSM geometry genuinely real.
3. **Quick Win 3: Add Real Sentinel-2 SWIR Imagery Crop (30–60 min)**
   - Rather than attempting a complex live Copernicus OAuth2 pipeline that could fail during the demo, fetch an authentic Copernicus Sentinel-2 Level-2A SWIR crop (B12/B11/B8A) for Jamnagar, place it in `public/assets/sentinel2/`, and render the real satellite image in the Investigation Drawer when Sentinel-2 evidence is inspected.
4. **Deliberate Avoidance: DO NOT attempt to repair Supabase**
   - Supabase host DNS resolution fails. Debugging remote cloud database connectivity introduces immense risk for zero presentation value. The current local file-backed architecture is robust, fast, and guaranteed offline-safe.
