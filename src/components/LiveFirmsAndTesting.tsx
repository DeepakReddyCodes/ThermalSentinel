import React, { useState } from 'react';
import {
  Cpu,
  Flame,
  Radio,
  Download,
  Upload,
  Play,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { Facility, ThermalEvent, InvestigationCase } from '../types';
import { generateControlledAnomaly, parseFirmsCsv, fetchBackendFirmsObservations } from '../services/firmsService';

interface LiveFirmsAndTestingProps {
  facilities: Facility[];
  onAddEvent: (event: ThermalEvent) => void;
  onBulkAddEvents: (events: ThermalEvent[]) => void;
  onNavigateToInvestigation: (caseId: string) => void;
}

export const LiveFirmsAndTesting: React.FC<LiveFirmsAndTestingProps> = ({
  facilities,
  onAddEvent,
  onBulkAddEvents,
  onNavigateToInvestigation,
}) => {
  const [apiKey, setApiKey] = useState<string>('');
  const [selectedSensor, setSelectedSensor] = useState<string>('VIIRS_NOAA20_NRT');
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>(facilities[0]?.id || '');
  const [scenarioType, setScenarioType] = useState<
    'TANK_FARM_CONTAINMENT_BREACH' | 'INTENSE_OFF_STACK_FLARING' | 'AGRICULTURAL_BOUNDARY_INTRUSION'
  >('TANK_FARM_CONTAINMENT_BREACH');
  const [isSimulatingApi, setIsSimulatingApi] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  const handleInjectScenario = () => {
    const targetFacility = facilities.find((f) => f.id === selectedFacilityId) || facilities[0];
    const syntheticEvent = generateControlledAnomaly(targetFacility, scenarioType);

    onAddEvent(syntheticEvent);
    setNotification(
      `Controlled Anomaly Scenario injected: ${syntheticEvent.id} (${syntheticEvent.frp} MW at ${targetFacility.name}). Marked as CONTROLLED_TEST (isRealData: false).`
    );
    setTimeout(() => setNotification(null), 5000);
  };

  const handleQueryFirms = async () => {
    setIsSimulatingApi(true);
    try {
      const res = await fetchBackendFirmsObservations({
        source: selectedSensor as any,
        country: 'IND',
        dayRange: 1,
      });
      if (res.events && res.events.length > 0) {
        onBulkAddEvents(res.events);
        setNotification(
          `NASA FIRMS Live Ingestion: ${res.events.length} canonical observations ingested from ${res.source} (Mode: ${res.dataMode}).`
        );
      } else {
        setNotification(`NASA FIRMS query completed: ${res.notes || 'No active hotspot records returned.'}`);
      }
    } catch (err: any) {
      setNotification(`NASA FIRMS query error: ${err.message}`);
    } finally {
      setIsSimulatingApi(false);
      setTimeout(() => setNotification(null), 6000);
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const parsedEvents = parseFirmsCsv(text, facilities);
        if (parsedEvents.length > 0) {
          onBulkAddEvents(parsedEvents);
          setNotification(`Successfully ingested ${parsedEvents.length} FIRMS events from uploaded CSV.`);
        } else {
          setNotification(`No valid thermal records found in CSV.`);
        }
      } catch (err: any) {
        setNotification(`Error parsing CSV: ${err.message}`);
      }
      setTimeout(() => setNotification(null), 5000);
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              NASA FIRMS Ingestion & Controlled Anomaly Testing
            </h1>
            <p className="text-xs text-slate-400">
              Live orbital sensor connections and §52 synthetic anomaly validation
            </p>
          </div>
        </div>
      </div>

      {notification && (
        <div className="p-4 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-amber-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Grid: Live API & Synthetic Generator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Controlled Anomaly Scenario Generator (§52) */}
        <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-rose-400" />
            <div>
              <h2 className="font-bold text-base text-slate-100">
                Controlled Anomaly Generator (§52)
              </h2>
              <p className="text-xs text-slate-400">
                Generate controlled thermal deviations to test ambiguity detection & evidence engine sensitivity
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label htmlFor="select-target-facility" className="text-xs text-slate-300 block mb-1 font-medium">
                Target Industrial Facility:
              </label>
              <select
                id="select-target-facility"
                value={selectedFacilityId}
                onChange={(e) => setSelectedFacilityId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl p-3 focus:outline-none focus:border-amber-500"
              >
                {facilities.map((fac) => (
                  <option key={fac.id} value={fac.id}>
                    {fac.name} ({fac.operator})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="select-scenario-type" className="text-xs text-slate-300 block mb-1 font-medium">
                Controlled Anomaly Scenario Preset:
              </label>
              <select
                id="select-scenario-type"
                value={scenarioType}
                onChange={(e: any) => setScenarioType(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl p-3 focus:outline-none focus:border-amber-500"
              >
                <option value="TANK_FARM_CONTAINMENT_BREACH">
                  1. Off-Stack Fire (Tank Farm Bunding - 750m off-stack, 68.5 MW FRP, Ambiguous)
                </option>
                <option value="INTENSE_OFF_STACK_FLARING">
                  2. Operational Flare Surge (In-Stack, 55.0 MW FRP, Moderate Deviation)
                </option>
                <option value="AGRICULTURAL_BOUNDARY_INTRUSION">
                  3. Agricultural Boundary Clearance (5.2km upwind, 21.0 MW FRP, Rural Burn)
                </option>
              </select>
            </div>

            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
              <strong className="text-slate-100 block mb-0.5">Scenario Description:</strong>
              {scenarioType === 'TANK_FARM_CONTAINMENT_BREACH' &&
                'Injects a high-intensity thermal anomaly outside the authorized flare stack radius. Forces the system into the AMBIGUOUS state (Flare vs Industrial Fire) to evaluate whether Next-Best-Evidence correctly triggers.'}
              {scenarioType === 'INTENSE_OFF_STACK_FLARING' &&
                'Simulates a scheduled high-pressure flare relief inside the authorized stack coordinates. Verifies that the system correctly identifies it as a routine flare without false alarms.'}
              {scenarioType === 'AGRICULTURAL_BOUNDARY_INTRUSION' &&
                'Simulates crop burning outside the facility buffer. Verifies that the contextual engine categorizes it as agricultural.'}
            </div>

            <button
              id="btn-inject-scenario"
              onClick={handleInjectScenario}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-rose-500/20"
            >
              <Flame className="w-4 h-4" />
              <span>Inject Controlled Anomaly Scenario</span>
            </button>
          </div>
        </div>

        {/* Card 2: NASA FIRMS Live Connector & CSV Ingest */}
        <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="font-bold text-base text-slate-100">
                NASA FIRMS Live API & CSV Ingestion
              </h2>
              <p className="text-xs text-slate-400">
                Connect your NASA Earthdata MAP_KEY or upload official FIRMS CSV exports
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-slate-300 block mb-1 font-medium">
                NASA FIRMS MAP_KEY (Optional / Configured):
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter 32-character FIRMS MAP_KEY (e.g. 7f8a9e...)"
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl p-3 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-300 block mb-1 font-medium">Satellite Source:</label>
                <select
                  value={selectedSensor}
                  onChange={(e) => setSelectedSensor(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl p-2.5 focus:outline-none"
                >
                  <option value="VIIRS_NOAA20_NRT">VIIRS (NOAA-20 375m)</option>
                  <option value="VIIRS_SNPP_NRT">VIIRS (Suomi-NPP 375m)</option>
                  <option value="MODIS_NRT">MODIS (Aqua/Terra 1km)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1 font-medium">Area of Interest:</label>
                <select className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl p-2.5 focus:outline-none">
                  <option value="IND">India (National Corridor)</option>
                  <option value="GUJ">Gujarat PCPIR & SEZ</option>
                  <option value="ODI">Odisha Smelting & Steel</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleQueryFirms}
                disabled={isSimulatingApi}
                className="flex-1 py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{isSimulatingApi ? 'Connecting Orbit...' : 'Query Active NASA FIRMS Feed'}</span>
              </button>
            </div>

            {/* CSV Upload Section */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <span className="text-xs text-slate-300 font-medium block">
                Or Ingest Custom NASA FIRMS CSV File:
              </span>
              <label className="flex items-center justify-center gap-2 p-3 bg-slate-950/60 hover:bg-slate-950 rounded-xl border border-dashed border-slate-700 cursor-pointer text-xs text-slate-400 hover:text-slate-200 transition">
                <Upload className="w-4 h-4 text-amber-400" />
                <span>Choose NASA FIRMS CSV (.csv)</span>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
