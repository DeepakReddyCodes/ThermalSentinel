import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { MONITORED_FACILITIES } from './server/facilities';
import { fetchLiveFirmsObservations } from './server/firms';
import { getAllFacilityBaselines, getFacilityBaseline, invalidateBaselineCache } from './server/baselineRepository';
import { ingestFacilityFirmsHistorical } from './scripts/ingest_key_industrial_hubs';
import {
  getInvestigationQueue,
  getOrCreateInvestigationCase,
  incorporateEvidenceIntoCase,
  resolveInvestigationCase,
  resetInvestigationCase,
  JAMNAGAR_OBSERVED_ACTIVITY_ZONES,
} from './server/investigationEngine';
import { fetchSentinel2SwirEvidence } from './server/sentinelHub';
import { queryNearbyOsmInfrastructure } from './server/osm';
import { getHistoricalWeatherContext } from './server/weather';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. Health check & Diagnostics
  app.get('/api/health', (req, res) => {
    const firmsKeyConfigured = Boolean(process.env.FIRMS_MAP_KEY?.trim());
    const dbConfigured = Boolean(process.env.DATABASE_URL?.trim());

    res.json({
      status: 'HEALTHY',
      system: 'ThermalSentinel Real Geospatial Backend',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      firms_configured: firmsKeyConfigured,
      firms_data_mode: firmsKeyConfigured ? 'NASA_REST_API' : 'NASA_OPEN_NRT_FEED',
      database: {
        status: dbConfigured ? 'CONNECTED' : 'UNCONFIGURED',
        message: dbConfigured
          ? 'PostgreSQL database configured via DATABASE_URL'
          : 'DATABASE_URL is not set. Data is processed in-memory directly from NASA FIRMS feeds.',
        postgis_enabled: dbConfigured,
      },
      external_data_sources: {
        NASA_FIRMS_VIIRS_NOAA20: 'LIVE',
        NASA_FIRMS_VIIRS_SNPP: 'LIVE',
        NASA_FIRMS_MODIS: 'LIVE',
        SENTINEL_2_SWIR: Boolean(process.env.COPERNICUS_CLIENT_ID) ? 'LIVE_COPERNICUS_HUB' : 'FALLBACK_SIMULATED',
        OPENSTREETMAP_OVERPASS: 'LIVE_OVERPASS_API',
        WEATHER_MET_DATA: 'LIVE_OPEN_METEO_HISTORICAL',
        POSTGRES_POSTGIS: dbConfigured ? 'CONNECTED' : 'UNCONFIGURED',
      },
    });
  });

  // 2. Monitored industrial facilities
  app.get('/api/facilities', (req, res) => {
    res.json({
      status: 'SUCCESS',
      count: MONITORED_FACILITIES.length,
      facilities: MONITORED_FACILITIES,
    });
  });

  // 3. Real NASA FIRMS live observation feed with spatial association
  app.get('/api/firms/observations', async (req, res) => {
    try {
      const source = (req.query.source as string) || 'VIIRS_NOAA20_NRT';
      const country = (req.query.country as string) || 'IND';
      const dayRange = parseInt((req.query.day_range as string) || '1', 10);
      const minFrp = parseFloat((req.query.min_frp as string) || '0.0');
      const associateFacilities = req.query.associate_facilities !== 'false';

      const result = await fetchLiveFirmsObservations({
        source,
        country,
        dayRange,
        minFrp,
        associateFacilities,
        facilities: MONITORED_FACILITIES,
      });

      res.json(result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        status: 'ERROR',
        count: 0,
        source: 'NASA FIRMS',
        is_live_external: false,
        data_mode: 'UNAVAILABLE_NO_KEY',
        observations: [],
        notes: `Server failed to process NASA FIRMS query: ${errorMsg}`,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 4. Facility Baselines (Empirical / Insufficient Data)
  app.get('/api/baselines', async (req, res) => {
    try {
      const baselines = await getAllFacilityBaselines();
      res.json({
        status: 'SUCCESS',
        count: baselines.length,
        baselines,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  app.get(['/api/baselines/:facilityId', '/api/facilities/:facilityId/baseline'], async (req, res) => {
    try {
      const baseline = await getFacilityBaseline(req.params.facilityId);
      if (!baseline) {
        return res.status(404).json({ status: 'ERROR', message: `Facility ${req.params.facilityId} not found` });
      }
      res.json({
        status: 'SUCCESS',
        baseline,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  // 4b. On-Demand NASA FIRMS Baseline Discovery & Ingestion
  app.post('/api/baselines/discover/:facilityId', async (req, res) => {
    try {
      const facilityId = req.params.facilityId;
      const result = await ingestFacilityFirmsHistorical(facilityId);
      invalidateBaselineCache(facilityId);
      const updatedBaseline = await getFacilityBaseline(facilityId);
      res.json({
        status: result.success ? 'SUCCESS' : 'ERROR',
        result,
        baseline: updatedBaseline,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  // 5. Historical Observations for a facility
  app.get('/api/observations/historical/:facilityId', (req, res) => {
    try {
      const facilityId = req.params.facilityId;
      const histPath = path.join(process.cwd(), 'data', 'processed', `${facilityId}_historical_observations.json`);
      const candPath = path.join(process.cwd(), 'data', 'processed', `${facilityId}_candidate_observations.json`);
      const filePath = fs.existsSync(histPath) ? histPath : fs.existsSync(candPath) ? candPath : null;
      if (filePath) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const obs = JSON.parse(raw);
        return res.json({
          status: 'SUCCESS',
          facility_id: facilityId,
          count: obs.length,
          observations: obs,
        });
      }
      res.json({
        status: 'SUCCESS',
        facility_id: facilityId,
        count: 0,
        observations: [],
        notes: 'No historical observations ingested yet for this facility.',
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  // 6. Investigation Cases Queue & Details
  app.get('/api/investigations', (req, res) => {
    try {
      const cases = getInvestigationQueue();
      res.json({
        status: 'SUCCESS',
        count: cases.length,
        cases,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  app.get('/api/investigations/:caseId', (req, res) => {
    try {
      const matched = getOrCreateInvestigationCase(req.params.caseId);
      if (!matched) {
        return res.status(404).json({ status: 'ERROR', message: `Investigation case ${req.params.caseId} not found` });
      }
      res.json({
        status: 'SUCCESS',
        case: matched,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  // Section 9: Closed Evidence Loop Endpoints
  app.post('/api/investigations/:caseId/evidence', async (req, res) => {
    try {
      const caseId = req.params.caseId;
      const evidencePayload = req.body || {};
      const updatedCase = await incorporateEvidenceIntoCase(caseId, evidencePayload);
      res.json({
        status: 'SUCCESS',
        message: 'Evidence incorporated successfully into closed investigation loop.',
        case: updatedCase,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  app.post('/api/investigations/:caseId/resolve', (req, res) => {
    try {
      const caseId = req.params.caseId;
      const { verdict, confidence, notes, evidence_used, investigator_id } = req.body || {};
      if (!verdict) {
        return res.status(400).json({ status: 'ERROR', message: 'verdict is required' });
      }
      const resolvedCase = resolveInvestigationCase(caseId, {
        verdict,
        confidence: typeof confidence === 'number' ? confidence : 85,
        notes: notes || '',
        evidence_used: evidence_used || [],
        investigator_id,
      });
      res.json({
        status: 'SUCCESS',
        message: 'Case formally resolved by investigator.',
        case: resolvedCase,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  app.post('/api/investigations/:caseId/reset', (req, res) => {
    try {
      const caseId = req.params.caseId;
      const resetCase = resetInvestigationCase(caseId);
      res.json({
        status: 'SUCCESS',
        message: 'Case reset to pristine T0 assessment.',
        case: resetCase,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  // 7. Observed Thermal Activity Zones
  app.get('/api/facilities/:facilityId/observed-zones', (req, res) => {
    const facilityId = req.params.facilityId;
    if (facilityId === 'FAC-GUJ-JAMNAGAR-01') {
      return res.json({
        status: 'SUCCESS',
        facility_id: facilityId,
        count: JAMNAGAR_OBSERVED_ACTIVITY_ZONES.length,
        observed_zones: JAMNAGAR_OBSERVED_ACTIVITY_ZONES,
      });
    }
    res.json({
      status: 'SUCCESS',
      facility_id: facilityId,
      count: 0,
      observed_zones: [],
      notes: 'No empirical observed activity zones calculated yet (requires min 30 historical observations).',
    });
  });

  // 8. Copernicus Data Space Sentinel-2 SWIR Evidence Provider
  app.get('/api/sentinel/swir', async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lon = parseFloat(req.query.lon as string);
      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ status: 'ERROR', message: 'Valid lat and lon required' });
      }
      const date = req.query.date as string | undefined;
      const timestamp = (req.query.timestamp as string) || (req.query.date as string) || undefined;
      const bufferKm = req.query.buffer_km ? parseFloat(req.query.buffer_km as string) : 2.0;
      const obsId = req.query.obs_id as string | undefined;
      const facilityId = req.query.facility_id as string | undefined;

      const result = await fetchSentinel2SwirEvidence({
        lat,
        lon,
        date,
        timestamp,
        bufferKm,
        obsId,
        facilityId,
      });

      res.json(result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  // 9. OpenStreetMap Industrial Infrastructure Context Provider
  app.get('/api/osm/context', async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lon = parseFloat(req.query.lon as string);
      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ status: 'ERROR', message: 'Valid lat and lon query parameters required' });
      }
      const radiusKm = req.query.radius_km ? parseFloat(req.query.radius_km as string) : 3.0;

      const result = await queryNearbyOsmInfrastructure(lat, lon, radiusKm);
      res.json(result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  // 10. Real Historical Weather & Wind Context Provider (Open-Meteo)
  app.get('/api/weather/context', async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lon = parseFloat(req.query.lon as string);
      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ status: 'ERROR', message: 'Valid lat and lon query parameters required' });
      }
      const timestamp = (req.query.timestamp as string) || (req.query.date as string) || new Date().toISOString();

      const result = await getHistoricalWeatherContext({ lat, lon, timestamp });
      res.json(result);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'ERROR', message: errorMsg });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ThermalSentinel server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
