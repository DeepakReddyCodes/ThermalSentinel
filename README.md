# ThermalSentinel: Evidence-Guided Industrial Thermal Intelligence

> **Transforming raw satellite thermal detections into auditable, evidence-guided operational intelligence.**

---

## 1. Overview

### Problem Statement
Satellite thermal anomaly sensors (such as NASA FIRMS VIIRS and MODIS) detect surface heat globally, but raw fire points lack facility context, operational baselines, and physical attribution. Operators and environmental regulators are overwhelmed by false alarms from routine gas flaring while high-risk industrial fires and off-zone combustions remain unclassified or ambiguous.

### Solution
**ThermalSentinel** is an evidence-guided industrial thermal intelligence system designed for continuous facility monitoring and regional anomaly triage. It bridges the gap between raw radiometric observations and actionable decision-making through:
- **3-Dimensional Semantic Classification**: Strict separation of *Observation Classification* (Anomalous, Elevated, Normal, Not Assessed), *Facility Association* (Known Process Zone, Facility Off-Zone, Buffer, Unassociated), and *Baseline Status* (Empirical, Limited, Not Assessed).
- **Empirical Facility Baselines**: Statistical characterization of routine operating ranges ($P_{75}, P_{95}$) derived from multi-month historical satellite observations.
- **Recursive Bayesian Hypothesis Updating**: Probabilistic attribution across 5 competing source hypotheses without double-counting derived evidence.
- **Shannon Entropy & Next-Best-Evidence (NBE)**: Information-theoretic optimization that calculates Expected Information Gain (EIG) to recommend the exact next observation required to collapse hypothesis uncertainty.

---

## 2. Core Operational Workflow

```
┌─────────────────┐
│     DETECT      │  Continuous NASA FIRMS VIIRS/MODIS telemetry ingestion (Day/Night passes)
└────────┬────────┘
         ▼
┌─────────────────┐
│     EXPLAIN     │  Spatial facility association & empirical baseline deviation ($P_{75}, P_{95}$)
└────────┬────────┘
         ▼
┌─────────────────┐
│    QUESTION     │  Multi-criteria Bayesian hypothesis assessment & Shannon entropy $H(P)$ calculation
└────────┬────────┘
         ▼
┌─────────────────┐
│     RESOLVE     │  Next-Best-Evidence (NBE / EIG) tasking & auditable operator verdict recording
└─────────────────┘
```

---

## 3. Key Capabilities

### A. 3-Dimensional Semantic Thermal Architecture
ThermalSentinel explicitly decouples spatial containment from radiometric classification:
1. **Observation Classification (Primary)**:
   - 🔴 **ANOMALOUS**: Significant deviation above facility $P_{95}$ baseline or extreme off-zone heat release.
   - 🟡 **ELEVATED**: Thermal activity above facility $P_{75}$ baseline or within buffer zones.
   - 🟢 **NORMAL**: Nominal combustion within empirical baseline operating envelope.
   - ⚪ **NOT ASSESSED**: Genuinely unclassifiable telemetry lacking sufficient evidence.
2. **Facility Association (Secondary)**:
   - `KNOWN_THERMAL_ZONE`: $\le 400\,\text{m}$ from registered industrial flare stacks or process units.
   - `FACILITY_OFF_ZONE`: Inside facility boundary polygon but $> 400\,\text{m}$ from known stacks.
   - `FACILITY_BUFFER`: Within configured facility outer perimeter ($\approx 1.5 - 3.5\,\text{km}$).
   - `UNASSOCIATED`: Regional detection outside monitored facility boundaries.
3. **Facility Baseline Status (Tertiary)**:
   - `EMPIRICAL`: Multi-month historical archive ($\ge 30$ active days, $N \ge 30$).
   - `CANDIDATE_EMPIRICAL_WITH_REVIEW`: Sufficient observations pending formal spatial review.
   - `LIMITED`: Sub-threshold observation history ($N < 30$).
   - `NOT_ASSESSED`: No facility baseline established.

### B. Recursive Bayesian Hypothesis Assessment
Evaluates posterior belief distributions $P(H_i \mid E)$ across 5 discrete source candidates:
1. **Routine / Relief Gas Flare**
2. **Industrial Fire / Abnormal Heat Release**
3. **Agricultural Crop Residue Burn**
4. **Wildfire / Vegetation Combustion**
5. **Other / Regional Thermal Source**

### C. Shannon Entropy & Next-Best-Evidence (NBE)
- **Uncertainty Metric**: Calculates Shannon Entropy $H(P) = -\sum_{i=1}^5 P(H_i)\log_2 P(H_i)$ over the hypothesis distribution.
- **Expected Information Gain (EIG)**: Evaluates candidate evidence sources (Sentinel-2 SWIR, Open-Meteo wind vectors, OpenStreetMap infrastructure, multi-pass persistence) to prioritize the highest information-gain acquisition at minimum operational cost.

### D. Interpretable Machine Learning Discriminator (`lr-v5f3-standardized`)
An auxiliary 7-feature logistic regression model provides linear log-odds feature contributions for radiometric gas flare vs. wildfire discrimination conditional on VIIRS I-band telemetry ($T_{I4}, T_{I5}, \Delta T, \log(1+\text{FRP})$, scan geometry).

---

## 4. System Architecture

```
ThermalSentinel/
├── src/
│   ├── components/            # UI Views (MonitorView, IntelligenceMap, InvestigationEngine)
│   ├── services/
│   │   ├── canonicalAssessment.ts      # 3-Dimension Thermal Semantic Classifier
│   │   ├── baselineDeviationEngine.ts  # Statistical Percentile Baseline Engine
│   │   ├── bayesianEngine.ts           # Recursive Bayesian Hypothesis Updating
│   │   ├── thermalDiscriminator.ts     # Standardized ML Discriminator (7 Features)
│   │   ├── firmsService.ts             # NASA FIRMS Telemetry Ingestion
│   │   ├── sentinelService.ts          # Copernicus Sentinel-2 SWIR Acquisition
│   │   ├── weatherService.ts           # Open-Meteo Historical & Live Weather API
│   │   └── overpassService.ts          # OpenStreetMap Geospatial Infrastructure API
│   ├── data/
│   │   ├── facilityRegistry.ts         # National Industrial Facility Registry (80 Facilities)
│   │   ├── historicalBaselines.ts      # Empirical Historical Baseline Statistics
│   │   └── investigationCases.ts       # Validated Operational Investigation Cases
│   └── types/                          # Strict TypeScript Data Contracts
├── backend/                            # Fastify / Node.js Server & Python Ingestion Utilities
├── scripts/                            # Verification & Cross-Facility Validation Test Suites
└── dist/                               # Optimized Production Build Artifacts
```

---

## 5. Technology Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Leaflet, Lucide Icons, Recharts
- **Backend / Build**: Node.js, Fastify / Vite 6, esbuild, TypeScript Compiler (`tsc`)
- **Telemetry & Remote Sensing APIs**:
  - NASA FIRMS (VIIRS 375m N20/NOAA-21/SNPP & MODIS 1km)
  - Copernicus Data Space Ecosystem (Sentinel-2 MSI Level-2A SWIR B12/B8A/B4)
  - Open-Meteo API (Historical and Live Atmospheric ERA5 Reanalysis)
  - OpenStreetMap Overpass API (Industrial Infrastructure Geometry)
  - CARTO Basemaps (Dark Matter Authenticated Tile Layer) & Esri World Imagery

---

## 6. Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Installation & Environment Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/ThermalSentinel.git
   cd ThermalSentinel
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy the configuration template to `.env`:
   ```bash
   cp .env.example .env
   ```
   Add your API credentials to `.env`:
   ```env
   # Telemetry & Analysis Keys
   FIRMS_MAP_KEY=your_nasa_firms_key
   COPERNICUS_CLIENT_ID=your_copernicus_client_id
   COPERNICUS_CLIENT_SECRET=your_copernicus_client_secret
   GEMINI_API_KEY=your_gemini_api_key

   # Basemap Layer Keys
   VITE_CARTO_API_KEY=your_carto_key
   VITE_ARCGIS_API_KEY=your_arcgis_key
   ```

4. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Build for Production**:
   ```bash
   npm run build
   ```

---

## 7. Automated Validation Suites

Run the built-in TypeScript verification and operational test suites:

```bash
# Type Check
npx tsc --noEmit

# 3-Dimension Semantic Map Refactor Validation
npx tsx scripts/test_semantic_map_classification.ts

# Behavioural Baseline & Percentile Model Audit
npx tsx scripts/validate_day2c1_behaviour.ts

# National Facility Registry (80 Facilities) & Geospatial Buffer Sanity Check
npx tsx scripts/validate_day2c2_cross_facility.ts
```

---

## 8. Methodological Notes & Governance

- **Bayesian Independence**: Spatial associations and historical baseline deviations form the likelihood foundations; derived contextual features (such as multi-pass clustering) are evaluated independently to prevent double-counting.
- **Evidence Provenance**: All satellite and sensor evidence items explicitly state their provenance (`AUTHENTIC_LIVE`, `HISTORICAL_ARCHIVE`, or `CONTROLLED_SCENARIO`). Controlled evaluation scenarios are clearly marked to maintain strict audit integrity.
- **Decision Support**: ThermalSentinel provides structured, explainable decision support and uncertainty quantification; final operational verdicts remain under human investigator control.

---

## 9. License

This project is licensed under the MIT License.