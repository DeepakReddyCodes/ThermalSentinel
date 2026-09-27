import React from 'react';
import {
  X,
  Terminal,
  Database,
  Key,
  Satellite,
  CheckSquare,
  Copy,
  ExternalLink,
  Layers,
  Server,
  FileCode,
} from 'lucide-react';

interface InfrastructureGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InfrastructureGuideModal: React.FC<InfrastructureGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-amber-400 font-bold px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                  SIH26162
                </span>
                <span className="text-xs text-slate-400 font-mono">Infrastructure & Manual Tasks Action Checklist</span>
              </div>
              <h2 className="text-lg font-bold text-slate-100 mt-0.5">
                ThermalSentinel Production Deployment & Integration Roadmap
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Checklist */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-300 leading-relaxed">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-200">
            <p className="font-semibold text-sm mb-1 text-amber-300">
              System Architecture &amp; Infrastructure Guide
            </p>
            The entire interactive frontend, geospatial map, baseline calculation engine, information entropy math, and evidence recommendation workflows are fully implemented and running live in this application. Below is the reference checklist of external API connections, database configurations, and background pipelines for operational telemetry ingestion.
          </div>

          {/* Task 1: NASA FIRMS MAP_KEY */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-100 flex items-center gap-2 text-sm">
                <Key className="w-4 h-4 text-amber-400" />
                <span>Task 1: Obtain Free NASA FIRMS API MAP_KEY</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                Est. Time: 2 mins
              </span>
            </div>
            <p className="text-slate-400">
              NASA FIRMS provides programmatic Near-Real-Time (NRT) satellite fire data (VIIRS NOAA-20, Suomi-NPP, MODIS) via REST API.
            </p>
            <ol className="list-decimal list-inside space-y-1 text-slate-300 pl-1">
              <li>Visit <a href="https://firms.modaps.eosdis.nasa.gov/api/map_key/" target="_blank" rel="noreferrer" className="text-sky-400 underline inline-flex items-center gap-0.5">NASA FIRMS MAP_KEY Registration <ExternalLink className="w-3 h-3" /></a></li>
              <li>Submit your email address to receive your 32-character hexadecimal <code className="text-amber-400 bg-slate-900 px-1 py-0.5 rounded">MAP_KEY</code>.</li>
              <li>Add this key to your <code className="text-amber-400 bg-slate-900 px-1 py-0.5 rounded">.env</code> file under <code className="text-slate-200">FIRMS_MAP_KEY</code>.</li>
            </ol>
          </div>

          {/* Task 2: PostgreSQL + PostGIS Database */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-100 flex items-center gap-2 text-sm">
                <Database className="w-4 h-4 text-sky-400" />
                <span>Task 2: PostgreSQL + PostGIS Spatial Schema Setup</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                PostGIS SQL
              </span>
            </div>
            <p className="text-slate-400">
              Execute this standard PostGIS DDL script in your PostgreSQL instance to index facility polygons and thermal hotspot points for spatial queries:
            </p>
            <div className="relative bg-slate-900 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-200 overflow-x-auto">
              <button
                onClick={() =>
                  copyToClipboard(
                    `-- 1. Enable PostGIS Extension\nCREATE EXTENSION IF NOT EXISTS postgis;\n\n-- 2. Industrial Facilities Table\nCREATE TABLE facilities (\n  id VARCHAR(64) PRIMARY KEY,\n  name VARCHAR(255) NOT NULL,\n  operator VARCHAR(255),\n  category VARCHAR(64),\n  geom GEOMETRY(Polygon, 4326),\n  baseline_median_frp NUMERIC(6,2),\n  typical_detections_per_day NUMERIC(4,2)\n);\n\n-- 3. Documented Thermal Zones Table\nCREATE TABLE thermal_zones (\n  id VARCHAR(64) PRIMARY KEY,\n  facility_id VARCHAR(64) REFERENCES facilities(id),\n  name VARCHAR(255),\n  zone_type VARCHAR(64),\n  geom GEOMETRY(Point, 4326),\n  buffer_radius_meters NUMERIC(6,2)\n);\n\n-- 4. FIRMS Ingested Hotspots Table\nCREATE TABLE firms_hotspots (\n  id VARCHAR(64) PRIMARY KEY,\n  geom GEOMETRY(Point, 4326),\n  frp NUMERIC(6,2),\n  brightness NUMERIC(6,2),\n  acq_time TIMESTAMP WITH TIME ZONE,\n  satellite VARCHAR(32),\n  confidence VARCHAR(16)\n);\n\n-- 5. Spatial Indexing\nCREATE INDEX idx_facilities_geom ON facilities USING GIST(geom);\nCREATE INDEX idx_firms_geom ON firms_hotspots USING GIST(geom);`
                  )
                }
                className="absolute top-2 right-2 p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Copy SQL"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <pre>{`-- 1. Enable PostGIS Extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Create Facilities Polygon Table
CREATE TABLE facilities (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  geom GEOMETRY(Polygon, 4326),
  baseline_median_frp NUMERIC(6,2)
);

-- 3. Spatial Indices for Sub-Second Point-in-Polygon
CREATE INDEX idx_facilities_geom ON facilities USING GIST(geom);`}</pre>
            </div>
          </div>

          {/* Task 3: Copernicus Sentinel-2 MSI Access */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-100 flex items-center gap-2 text-sm">
                <Satellite className="w-4 h-4 text-emerald-400" />
                <span>Task 3: Copernicus Data Space Ecosystem API (Sentinel-2 SWIR)</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                Free ESA Access
              </span>
            </div>
            <p className="text-slate-400">
              For on-demand Sentinel-2 L2A MSI tile queries (Bands 12, 11, 8A):
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300 pl-1">
              <li>Register at <a href="https://dataspace.copernicus.eu/" target="_blank" rel="noreferrer" className="text-sky-400 underline inline-flex items-center gap-0.5">dataspace.copernicus.eu <ExternalLink className="w-3 h-3" /></a></li>
              <li>Generate OAuth2 Client Credentials for the Sentinel Hub / CDSE OData API.</li>
              <li>Store credentials in <code className="text-slate-200">COPERNICUS_CLIENT_ID</code> and <code className="text-slate-200">COPERNICUS_CLIENT_SECRET</code>.</li>
            </ul>
          </div>

          {/* Task 4: Python FastAPI Backend Service */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-100 flex items-center gap-2 text-sm">
                <Server className="w-4 h-4 text-purple-400" />
                <span>Task 4: 15-Minute Cron Ingestion Daemon (Python/FastAPI)</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                Automation
              </span>
            </div>
            <p className="text-slate-400">
              Deploy a small Python background task (Celery / APScheduler / Cloud Scheduler) that executes every 15 minutes:
            </p>
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300">
              <p className="text-emerald-400 font-bold"># Cron Workflow:</p>
              <p>1. GET https://firms.modaps.eosdis.nasa.gov/api/country/csv/{'{MAP_KEY}'}/VIIRS_NOAA20_NRT/IND/1</p>
              <p>2. Perform PostGIS ST_Contains spatial query against monitored facility polygons</p>
              <p>3. Calculate z-score & percentile deviation against facility historical baseline table</p>
              <p>4. If ambiguous (off-stack & FRP deviation &gt; 50%), create Case & trigger Next-Best-Evidence webhook</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <span className="text-xs text-slate-400 font-mono">
            Document Version: ThermalSentinel v1.0.0-SIH26162
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition"
          >
            Got It, Close Checklist
          </button>
        </div>
      </div>
    </div>
  );
};
