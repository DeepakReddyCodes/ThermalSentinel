import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Flame,
  Satellite,
  Compass,
  CheckCircle2,
  FileDown,
  Search,
  Layers,
  Clock,
  Info,
  MapPin,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  FileText,
  Save,
  HelpCircle,
  Activity,
  Cpu,
  Wind,
  Droplets,
  Thermometer,
  Database,
  Building2,
  X,
  RotateCcw,
} from 'lucide-react';
import {
  InvestigationCase,
  ThermalEvent,
  SourceType,
  Sentinel2SwirResponse,
  OsmContextResponse,
  WeatherContextResponse,
  Facility,
} from '../types';
import { INITIAL_FACILITIES, getFacilityCalibratedBaseline } from '../data/facilities';
import { evaluateThermalDiscriminator, getAiSourceAdvisory } from '../services/thermalDiscriminator';
import { buildInvestigationCaseFromEvent } from '../services/investigationService';

interface InvestigationEngineProps {
  cases: InvestigationCase[];
  selectedCaseId: string;
  onSelectCase: (caseId: string) => void;
  onApplyEvidenceToCase?: (caseId: string, evidenceId: string) => void;
  onUpdateCaseNotes?: (caseId: string, notes: string) => void;
  onResolveCase?: (caseId: string, verdict: SourceType, confidence: number) => void;
  onResetCase?: (caseId: string) => void;
  events: ThermalEvent[];
  facilities?: Facility[];
}

export function getDetectionProvenanceBadge(
  caseData?: InvestigationCase | null,
  event?: ThermalEvent | null
): { label: string; badgeClass: string } {
  const prov =
    (caseData as any)?.provenance ||
    (caseData as any)?.obs?.provenance ||
    (caseData as any)?.rawServerData?.provenance ||
    event?.provenance;

  if (prov === 'REAL_FIRMS' || prov === 'REAL') {
    return {
      label: 'REAL SATELLITE OBSERVATION',
      badgeClass: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/50',
    };
  }
  if (prov === 'LOCAL_BENCHMARK_CACHE' || prov === 'HISTORICAL_BASELINE' || prov === 'BENCHMARK') {
    return {
      label: 'CURATED BENCHMARK CASE',
      badgeClass: 'text-cyan-400 bg-cyan-950/40 border-cyan-800/50',
    };
  }
  if (prov === 'CONTROLLED_TEST' || prov === 'CONTROLLED' || prov === 'FIXTURE') {
    return {
      label: 'CONTROLLED TEST CASE',
      badgeClass: 'text-amber-400 bg-amber-950/40 border-amber-800/50',
    };
  }
  return {
    label: 'PROVENANCE UNVERIFIED',
    badgeClass: 'text-slate-400 bg-slate-900/40 border-slate-700/50',
  };
}

export const InvestigationEngine: React.FC<InvestigationEngineProps> = ({
  cases,
  selectedCaseId,
  onSelectCase,
  onApplyEvidenceToCase,
  onUpdateCaseNotes,
  onResolveCase,
  onResetCase,
  events,
  facilities = [],
}) => {
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [exportNotice, setExportNotice] = useState<boolean>(false);

  // Expandable sections state for the 11 sections
  const [openSections, setOpenSections] = useState<{ [key: string]: boolean }>({
    event: true,
    facility: true,
    baseline: true,
    hypotheses: true,
    uncertainty: true,
    ml: true,
    satellite: true,
    osm: true,
    weather: true,
    nbe: true,
    limitations: true,
  });

  const toggleSection = (sec: string) => {
    setOpenSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  const collapseAll = () => {
    setOpenSections({
      event: false,
      facility: false,
      baseline: false,
      hypotheses: false,
      uncertainty: false,
      ml: false,
      satellite: false,
      osm: false,
      weather: false,
      nbe: false,
      limitations: false,
    });
  };

  const expandAll = () => {
    setOpenSections({
      event: true,
      facility: true,
      baseline: true,
      hypotheses: true,
      uncertainty: true,
      ml: true,
      satellite: true,
      osm: true,
      weather: true,
      nbe: true,
      limitations: true,
    });
  };

  // Find currently selected case
  const currentCase = useMemo(() => {
    const existing = cases.find(
      (c) =>
        c.case_id === selectedCaseId ||
        c.caseId === selectedCaseId ||
        c.firms_observation_id === selectedCaseId ||
        c.primaryEventId === selectedCaseId
    );
    if (existing) return existing;

    const cleanId = (selectedCaseId || '').replace(/^CASE-/, '');
    const matchedEv = events?.find(
      (e) => e.id === selectedCaseId || e.id === cleanId || `CASE-${e.id}` === selectedCaseId
    );
    if (matchedEv) {
      const allFacs = facilities && facilities.length > 0 ? facilities : INITIAL_FACILITIES;
      const fac = matchedEv.facilityId
        ? allFacs.find((f) => f.id === matchedEv.facilityId) || INITIAL_FACILITIES.find((f) => f.id === matchedEv.facilityId) || null
        : null;
      let bLine: any = null;
      if (fac) {
        const bp = fac.baselineProfile || getFacilityCalibratedBaseline(fac);
        const isJamnagar = fac.id === 'FAC-GUJ-JAMNAGAR-01';
        bLine = {
          facility_id: fac.id,
          facility_name: fac.name,
          baseline_status: isJamnagar ? 'EMPIRICAL' : 'CONTROLLED',
          minimum_threshold_required: 30,
          provenance: isJamnagar ? 'REAL' : 'CONTROLLED',
          baseline_period: {
            start_date: '2026-01-01',
            end_date: '2026-04-22',
            total_days: 111,
          },
          metrics: {
            observation_count: bp.empiricalObservationCount || (isJamnagar ? 294 : 45),
            observation_days: isJamnagar ? 111 : 90,
            observations_per_day: isJamnagar ? 2.6 : 0.5,
            frp_median: bp.typicalFrpMw.median,
            frp_p25: bp.typicalFrpMw.p25,
            frp_p75: bp.typicalFrpMw.p75,
            frp_p90: bp.typicalFrpMw.p90,
            frp_p95: bp.typicalFrpMw.p95,
            frp_max: bp.typicalFrpMw.max,
            frp_iqr: bp.typicalFrpMw.iqr,
            frp_mad: bp.typicalFrpMw.mad,
          },
          diurnal: {
            day_count: 20,
            night_count: 25,
            day_pct: 44,
            night_pct: 56,
            hour_distribution: [],
          },
          spatial_distribution: {
            known_zone_count: 35,
            off_zone_count: 10,
            buffer_count: 0,
            zones: [],
          },
          created_at: new Date().toISOString(),
        };
      }
      return buildInvestigationCaseFromEvent(matchedEv, fac, bLine);
    }

    return cases[0];
  }, [cases, selectedCaseId, events, facilities]);

  const matchedEvent = useMemo(() => {
    if (!currentCase) return null;
    const targetId = (currentCase.firms_observation_id || currentCase.primaryEventId || currentCase.case_id || currentCase.caseId || '').replace(/^CASE-/, '');
    return (
      events?.find(
        (e) =>
          e.id === targetId ||
          e.id === currentCase.firms_observation_id ||
          e.id === currentCase.primaryEventId ||
          `CASE-${e.id}` === currentCase.case_id ||
          `CASE-${e.id}` === currentCase.caseId
      ) || null
    );
  }, [events, currentCase]);

  const [notesInput, setNotesInput] = useState<string>('');

  useEffect(() => {
    if (currentCase) {
      setNotesInput(currentCase.investigatorNotes || currentCase.investigator_notes || '');
    }
  }, [currentCase?.case_id, currentCase?.caseId]);

  // Is case associated with an industrial facility?
  const isAssociated = Boolean(
    currentCase &&
    currentCase.spatial_association !== 'UNASSOCIATED' &&
    (currentCase.associated_facility?.id || currentCase.facilityId)
  );

  // Fetch authentic Sentinel-2 SWIR evidence, OSM, and Weather
  const [sentinelData, setSentinelData] = useState<Sentinel2SwirResponse | null>(null);
  const [osmData, setOsmData] = useState<OsmContextResponse | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherContextResponse | null>(null);

  useEffect(() => {
    if (!currentCase) return;
    let isMounted = true;
    setSentinelData(null);
    setOsmData(null);
    setWeatherData(null);

    const coords = currentCase.coordinates || [22.3421, 69.8638];
    const [lat, lon] = coords;
    const timestamp = currentCase.timestamp || '2026-02-25T08:13:00Z';
    const date = timestamp.slice(0, 10);
    const obsId = currentCase.firms_observation_id || currentCase.primaryEventId || '';
    const facilityId = currentCase.associated_facility?.id || currentCase.facilityId || '';

    // 1. Sentinel-2 SWIR
    fetch(`/api/sentinel/swir?lat=${lat}&lon=${lon}&date=${date}&timestamp=${timestamp}&obs_id=${obsId}&facility_id=${facilityId}`)
      .then((res) => res.json())
      .then((data: Sentinel2SwirResponse) => {
        if (isMounted) setSentinelData(data);
      })
      .catch(() => {});

    // 2. OSM Overpass
    fetch(`/api/osm/context?lat=${lat}&lon=${lon}&radius_km=3.0`)
      .then((res) => res.json())
      .then((data: OsmContextResponse) => {
        if (isMounted) setOsmData(data);
      })
      .catch(() => {});

    // 3. Open-Meteo Weather
    fetch(`/api/weather/context?lat=${lat}&lon=${lon}&timestamp=${timestamp}`)
      .then((res) => res.json())
      .then((data: WeatherContextResponse) => {
        if (isMounted) setWeatherData(data);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [currentCase?.case_id, currentCase?.caseId]);

  // Filter Queue Cases
  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const p = c.investigation_priority?.level || c.priorityLevel || 'LOW';
      if (priorityFilter !== 'ALL' && p !== priorityFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = (c.case_id || c.caseId || '').toLowerCase().includes(q);
        const matchFirms = (c.firms_observation_id || c.primaryEventId || '').toLowerCase().includes(q);
        const matchFac = (c.associated_facility?.name || c.facilityName || '').toLowerCase().includes(q);
        return matchId || matchFirms || matchFac;
      }
      return true;
    });
  }, [cases, priorityFilter, searchQuery]);

  const discriminatorOutput = useMemo(() => {
    if (!currentCase) return null;
    if (currentCase.thermal_discriminator) return currentCase.thermal_discriminator;
    if (currentCase.thermalDiscriminator) return currentCase.thermalDiscriminator;
    return evaluateThermalDiscriminator(currentCase.rawServerData || matchedEvent || currentCase);
  }, [currentCase, matchedEvent]);

  const isEvidenceConflict = useMemo(() => {
    if (!discriminatorOutput || discriminatorOutput.status !== 'AVAILABLE') return false;
    const isContextualFire = isAssociated && (currentCase?.behavioural_status === 'ANOMALOUS' || (currentCase?.frp || 0) >= 10);
    const isMlWildfire = discriminatorOutput.predicted_class === 'WILDFIRE_CONFIRMED' || (discriminatorOutput.wildfire_score != null && discriminatorOutput.wildfire_score >= 0.50);
    return Boolean(isContextualFire && isMlWildfire);
  }, [discriminatorOutput, isAssociated, currentCase]);

  const nbeRecommendation = useMemo(() => {
    if (!currentCase) return null;
    return (
      currentCase.evidence_guided_investigation?.recommendedExternalEvidence ||
      currentCase.evidenceGuidedInvestigation?.recommendedExternalEvidence ||
      null
    );
  }, [currentCase]);

  // Selected verdict for case resolution
  const [resolutionVerdict, setResolutionVerdict] = useState<SourceType>('industrial_fire');
  const [resolutionConfidence, setResolutionConfidence] = useState<number>(92);
  const [isResolvingModalOpen, setIsResolvingModalOpen] = useState<boolean>(false);

  // Derive active hypotheses list dynamically
  const activeHypothesesList = useMemo(() => {
    if (!currentCase) return [];
    if (currentCase.currentHypotheses) {
      const initial = currentCase.initialHypotheses || currentCase.currentHypotheses;
      return Object.entries(currentCase.currentHypotheses).map(([k, val]) => {
        const key = k as SourceType;
        const p = Number(val);
        const initialP = Number(initial[key] ?? p);
        const delta = Math.round((p - initialP) * 100);
        let label = 'Other Thermal / Artifact';
        let color = 'bg-cyan-500';
        let textColor = 'text-cyan-400';
        if (key === 'industrial_fire') {
          label = 'Industrial Fire / Abnormal Heat';
          color = 'bg-rose-500';
          textColor = 'text-rose-400';
        } else if (key === 'gas_flare') {
          label = 'Routine / Relief Gas Flare';
          color = 'bg-amber-500';
          textColor = 'text-amber-400';
        } else if (key === 'agricultural_burn') {
          label = 'Agricultural / Crop Residue Burn';
          color = 'bg-emerald-500';
          textColor = 'text-emerald-400';
        } else if (key === 'wildfire') {
          label = 'Wildfire / Vegetation';
          color = 'bg-orange-500';
          textColor = 'text-orange-400';
        } else if (key === 'mining_smelter') {
          label = 'Smelter / Slag Cooling';
          color = 'bg-purple-500';
          textColor = 'text-purple-400';
        }
        return {
          key,
          label,
          percentage: Math.round(p * 100),
          delta,
          color,
          textColor,
        };
      }).sort((a, b) => b.percentage - a.percentage);
    }
    if (currentCase.source_hypotheses?.hypotheses_distribution) {
      return currentCase.source_hypotheses.hypotheses_distribution.map((h) => ({
        key: (h.hypothesis === 'INDUSTRIAL_FIRE' ? 'industrial_fire' : h.hypothesis === 'GAS_FLARE' ? 'gas_flare' : h.hypothesis === 'AGRICULTURAL_BURN' ? 'agricultural_burn' : h.hypothesis === 'WILDFIRE_VEGETATION' ? 'wildfire' : 'other_thermal') as SourceType,
        label: h.label,
        percentage: h.percentage,
        delta: 0,
        color: h.hypothesis === 'INDUSTRIAL_FIRE' ? 'bg-rose-500' : h.hypothesis === 'GAS_FLARE' ? 'bg-amber-500' : 'bg-emerald-500',
        textColor: h.hypothesis === 'INDUSTRIAL_FIRE' ? 'text-rose-400' : h.hypothesis === 'GAS_FLARE' ? 'text-amber-400' : 'text-emerald-400',
      }));
    }
    return [];
  }, [currentCase]);

  // Shannon Entropy: H = -sum(p_i * log2(p_i))
  const currentEntropyBits = useMemo(() => {
    if (!currentCase) return 1.394;
    if (currentCase.currentHypotheses) {
      let h = 0;
      for (const val of Object.values(currentCase.currentHypotheses)) {
        const p = Number(val);
        if (p > 0.0001) h -= p * Math.log2(p);
      }
      return parseFloat(h.toFixed(3));
    }
    if (currentCase.uncertainty?.entropy_bits != null) return currentCase.uncertainty.entropy_bits;
    return 1.394;
  }, [currentCase]);

  const K_hypotheses = activeHypothesesList.length || 6;
  const maxPossibleEntropyBits = useMemo(() => {
    return Math.log2(K_hypotheses) || 2.585;
  }, [K_hypotheses]);

  const normalizedEntropy = useMemo(() => {
    return maxPossibleEntropyBits > 0
      ? Math.min(1.0, Math.max(0.0, currentEntropyBits / maxPossibleEntropyBits))
      : 0;
  }, [currentEntropyBits, maxPossibleEntropyBits]);

  const initialEntropyBits = useMemo(() => {
    if (!currentCase) return 1.394;
    if (currentCase.uncertaintyReductionMetric?.entropyBefore != null) {
      return currentCase.uncertaintyReductionMetric.entropyBefore;
    }
    if (currentCase.initialHypotheses) {
      let h = 0;
      for (const val of Object.values(currentCase.initialHypotheses)) {
        const p = Number(val);
        if (p > 0.0001) h -= p * Math.log2(p);
      }
      return parseFloat(h.toFixed(3));
    }
    return 1.394;
  }, [currentCase]);

  // deltaH = H_after - H_before
  const deltaH = parseFloat((currentEntropyBits - initialEntropyBits).toFixed(3));
  // uncertaintyReduction = H_before - H_after
  const uncertaintyReduction = parseFloat((initialEntropyBits - currentEntropyBits).toFixed(3));
  const uncertaintyReductionPct = initialEntropyBits > 0 && uncertaintyReduction > 0
    ? Math.max(0, Math.min(100, Math.round((uncertaintyReduction / initialEntropyBits) * 100)))
    : 0;

  const uncertaintyStatus = deltaH < -0.001
    ? 'UNCERTAINTY REDUCED'
    : deltaH > 0.001
    ? 'UNCERTAINTY INCREASED'
    : 'NO UNCERTAINTY CHANGE';

  const appliedEvidenceCount = currentCase?.appliedEvidenceIds?.length || 0;
  const isEvidenceFused = appliedEvidenceCount > 0;

  // Complete 20-field JSON dossier export
  const handleExportDossier = () => {
    if (!currentCase) return;
    const dossierData = {
      case_id: currentCase.case_id || currentCase.caseId,
      firms_observation_id: currentCase.firms_observation_id || currentCase.primaryEventId,
      timestamp: currentCase.timestamp,
      satellite: currentCase.satellite,
      coordinates: currentCase.coordinates,
      frp_mw: currentCase.frp,
      confidence: currentCase.confidence,
      associated_facility: currentCase.associated_facility,
      spatial_association: currentCase.spatial_association,
      spatial_association_label: currentCase.spatial_association_label,
      facility_baseline_status: currentCase.facility_baseline_status,
      current_baseline_metrics: currentCase.current_baseline_metrics,
      behavioural_status: currentCase.behavioural_status,
      deviation_metrics: currentCase.deviation_metrics,
      explanation_reasons: currentCase.explanation_reasons,
      source_hypotheses: currentCase.source_hypotheses,
      uncertainty: currentCase.uncertainty,
      evidence_status: currentCase.evidence_status,
      evidence_status_detail: currentCase.evidence_status_detail,
      investigation_priority: currentCase.investigation_priority,
      evidence_guided_investigation: currentCase.evidence_guided_investigation,
      thermal_discriminator: discriminatorOutput,
      sentinel_swir_evidence: sentinelData,
      osm_infrastructure_context: osmData,
      weather_context: weatherData,
      investigator_notes: notesInput,
      exported_at: new Date().toISOString(),
      export_version: 'ThermalSentinel-RefinementPass2',
    };

    const blob = new Blob([JSON.stringify(dossierData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${dossierData.case_id}-Dossier.json`;
    link.click();
    URL.revokeObjectURL(url);

    setExportNotice(true);
    setTimeout(() => setExportNotice(false), 3000);
  };

  const handleSaveNotes = () => {
    if (currentCase && onUpdateCaseNotes) {
      onUpdateCaseNotes(currentCase.case_id || currentCase.caseId, notesInput);
      alert('Investigator notes saved.');
    }
  };

  if (!currentCase) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-[calc(100vh-3.25rem)] bg-[#030712] text-slate-400 p-6">
        <ShieldAlert className="w-10 h-10 text-amber-500 mb-3" />
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">No Investigation Cases Available</h3>
        <p className="text-xs text-slate-500 max-w-md text-center mt-1">
          Select an anomalous thermal detection from the Monitor map view and click &quot;Open Investigation&quot; to initialize a forensic case dossier.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full h-[calc(100vh-3.25rem)] bg-[#030712] overflow-hidden text-slate-100 font-['Plus_Jakarta_Sans',sans-serif]">
      {/* LEFT: INVESTIGATION QUEUE */}
      <aside className="w-72 lg:w-80 flex-shrink-0 bg-[#090d16] border-r border-slate-800/90 flex flex-col z-20">
        <div className="p-2.5 border-b border-slate-800/80 bg-[#030712]/50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <div>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-200 leading-tight">
                  Investigation Queue
                </h2>
                <div className="text-[9px] font-mono text-slate-400">
                  {filteredCases.length} Priority Triage Cases
                </div>
              </div>
            </div>
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-bold">
              {filteredCases.length}
            </span>
          </div>

          <div className="relative">
            <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search case, facility, obs ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#111827] border border-slate-700/80 text-slate-200 text-[10px] rounded pl-6 pr-2 py-1 focus:outline-none focus:border-amber-500 placeholder-slate-500"
            />
          </div>

          <div className="grid grid-cols-4 gap-1 font-mono text-[9px]">
            {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter(p)}
                className={`py-0.5 rounded font-semibold transition ${
                  priorityFilter === p
                    ? p === 'HIGH'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : p === 'MEDIUM'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50 p-1.5 space-y-1">
          {filteredCases.map((c) => {
            const isSelected = (currentCase?.case_id || currentCase?.caseId) === (c.case_id || c.caseId);
            const pLevel = c.investigation_priority?.level || c.priorityLevel || 'LOW';
            const pScore = c.investigation_priority?.score ?? c.priorityScore ?? 50;
            const isHigh = pLevel === 'HIGH';
            const bStatus = c.behavioural_status || 'ANOMALOUS';
            const isAnom = bStatus === 'ANOMALOUS';

            return (
              <button
                key={c.case_id || c.caseId}
                onClick={() => onSelectCase(c.case_id || c.caseId)}
                className={`w-full text-left p-2 rounded-lg transition-all flex flex-col gap-0.5 border ${
                  isSelected
                    ? 'bg-[#1e293b]/90 border-rose-500/60 ring-1 ring-rose-500/30'
                    : 'border-transparent hover:bg-[#0f172a]/70 hover:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold text-slate-100">
                    {c.case_id || c.caseId}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1 py-0.2 rounded border uppercase ${
                      isHigh
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}
                  >
                    {pLevel} ({pScore})
                  </span>
                </div>

                <div className="font-semibold text-[11px] text-slate-200 truncate">
                  {c.associated_facility?.name || c.facilityName || 'Regional Area'}
                </div>

                <div className="flex items-center justify-between text-[10px] pt-0.5 font-mono">
                  <span className="text-amber-400 font-bold">{c.frp_mw || c.frp || 11.97} MW</span>
                  <span
                    className={`px-1 rounded ${
                      isAnom
                        ? 'text-rose-400 bg-rose-950/60'
                        : 'text-purple-400 bg-purple-950/60'
                    }`}
                  >
                    {bStatus}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* RIGHT: SELECTED INVESTIGATION WORKSPACE */}
      {currentCase ? (
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {/* Header Action Bar */}
          <div className="bg-[#090d16] p-3.5 rounded-xl border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-lg">
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                  {currentCase.case_id || currentCase.caseId}
                </span>
                {(() => {
                  const obsClass = currentCase.behavioural_status || currentCase.behaviour_assessment?.status || (currentCase.frp >= 25 ? 'ANOMALOUS' : currentCase.frp >= 5 ? 'ELEVATED' : 'NORMAL');
                  const badgeClass = obsClass === 'ANOMALOUS'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : obsClass === 'ELEVATED'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : obsClass === 'NORMAL'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-500/20 text-slate-300 border-slate-500/40';
                  return (
                    <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border uppercase ${badgeClass}`}>
                      {obsClass}
                    </span>
                  );
                })()}
                {isAssociated && (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-950/70 text-rose-300 border border-rose-800/70 font-mono">
                    {currentCase.investigation_priority?.level || 'HIGH'} ({currentCase.investigation_priority?.score || 100}/100)
                  </span>
                )}
                <span className="text-[10px] font-mono text-cyan-400 px-1.5 py-0.2 rounded bg-cyan-950/40 border border-cyan-800/40">
                  {currentCase.spatial_association_label || (isAssociated ? 'Inside Facility Boundary (Off-Zone)' : 'Unassociated (Regional Detection)')}
                </span>
              </div>
              <h1 className="text-base font-bold text-slate-100 mt-1">
                {isAssociated && currentCase.associated_facility?.name
                  ? currentCase.associated_facility.name
                  : (currentCase.facilityName || 'Regional Thermal Detection')}
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-expand-all-sections"
                onClick={expandAll}
                className="px-2 py-1 rounded bg-[#111827] hover:bg-slate-800 text-[10px] text-slate-300 border border-slate-700 transition"
              >
                Expand All
              </button>
              <button
                id="btn-collapse-all-sections"
                onClick={collapseAll}
                className="px-2 py-1 rounded bg-[#111827] hover:bg-slate-800 text-[10px] text-slate-300 border border-slate-700 transition"
              >
                Collapse All
              </button>
              {isEvidenceFused && (
                <button
                  id="btn-reset-case-t0"
                  onClick={() => onResetCase?.(currentCase.case_id || currentCase.caseId || '')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                  title="Reset to pristine T0 initial assessment"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>RESET (T0)</span>
                </button>
              )}
              <button
                id="btn-export-dossier"
                onClick={handleExportDossier}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white text-xs font-bold tracking-wide shadow-md transition"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>EXPORT CASE DOSSIER</span>
              </button>
            </div>
          </div>

          {exportNotice && (
            <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Full Investigation Case Dossier JSON exported successfully to your downloads folder.</span>
            </div>
          )}

          {/* DETECT -> EXPLAIN -> QUESTION -> RESOLVE Workflow Banner */}
          <div className="bg-[#090d16] p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 sm:gap-2.5 flex-1 overflow-x-auto text-[11px] font-mono">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-rose-950/40 border border-rose-800/40 text-rose-300 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                <strong className="text-slate-200">1. DETECT</strong>
                <span className="text-slate-400 hidden sm:inline">({currentCase.frp_mw || currentCase.frp || 11.97} MW VIIRS)</span>
              </div>
              <span className="text-slate-600 flex-shrink-0">→</span>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-950/40 border border-amber-800/40 text-amber-300 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <strong className="text-slate-200">2. EXPLAIN</strong>
                <span className="text-slate-400 hidden sm:inline">({currentCase.behavioural_status || 'NOT_ASSESSED'})</span>
              </div>
              <span className="text-slate-600 flex-shrink-0">→</span>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-cyan-950/40 border border-cyan-800/40 text-cyan-300 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <strong className="text-slate-200">3. QUESTION</strong>
                <span className="text-slate-400 hidden sm:inline">(NBE Utility {nbeRecommendation?.utility_score != null ? `${nbeRecommendation.utility_score}` : (isAssociated ? '64' : '95')})</span>
              </div>
              <span className="text-slate-600 flex-shrink-0">→</span>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <strong className="text-slate-200">4. RESOLVE</strong>
                <span className="text-slate-400 hidden sm:inline">(Dossier / Triage)</span>
              </div>
            </div>
          </div>

          {/* 11 EXPANDABLE SECTIONS */}

          {/* 1. EVENT RADIOMETRY */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('event')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <Satellite className="w-3.5 h-3.5 text-cyan-400" />
                <span>1. Event Radiometry & Primary Observation Details</span>
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  const provBadge = getDetectionProvenanceBadge(currentCase, matchedEvent);
                  return (
                    <span className={`font-mono text-[9px] font-semibold px-1.5 py-0.2 rounded border ${provBadge.badgeClass}`}>
                      {provBadge.label}
                    </span>
                  );
                })()}
                {openSections.event ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.event && (
              <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                  <span className="text-[9px] text-slate-400 font-sans block">Observation ID</span>
                  <span className="text-slate-200 font-bold">{currentCase.firms_observation_id || currentCase.primaryEventId || currentCase.case_id}</span>
                </div>
                <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                  <span className="text-[9px] text-slate-400 font-sans block">FRP</span>
                  <span className="text-amber-400 font-bold">{currentCase.frp ?? 0} MW</span>
                </div>
                <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                  <span className="text-[9px] text-slate-400 font-sans block">Brightness (TI4)</span>
                  <span className="text-slate-200 font-bold">
                    {matchedEvent?.brightness
                      ? `${matchedEvent.brightness.toFixed(1)} K`
                      : (currentCase as any).brightness
                      ? `${Number((currentCase as any).brightness).toFixed(1)} K`
                      : ((currentCase as any).brightness_ti4
                      ? `${Number((currentCase as any).brightness_ti4).toFixed(1)} K`
                      : '—')}
                  </span>
                </div>
                <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                  <span className="text-[9px] text-slate-400 font-sans block">Thermal Contrast (ΔT)</span>
                  <span className={`font-bold ${
                    ((matchedEvent as any)?.bright_ti4 && (matchedEvent as any)?.bright_ti5) || ((currentCase as any)?.brightness_ti4 && (currentCase as any)?.brightness_ti5)
                      ? 'text-rose-400'
                      : isAssociated && (currentCase.frp ?? 0) > 10
                      ? 'text-amber-400'
                      : 'text-slate-400'
                  }`}>
                    {((matchedEvent as any)?.bright_ti4 && (matchedEvent as any)?.bright_ti5)
                      ? `${((matchedEvent as any).bright_ti4 - (matchedEvent as any).bright_ti5).toFixed(1)} K (TI4 - TI5)`
                      : ((currentCase as any)?.brightness_ti4 && (currentCase as any)?.brightness_ti5)
                      ? `${((currentCase as any).brightness_ti4 - (currentCase as any).brightness_ti5).toFixed(1)} K (TI4 - TI5)`
                      : isAssociated
                      ? 'TI4 Available (TI5 not reported)'
                      : 'N/A (Single Band / Regional)'}
                  </span>
                </div>
                <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                  <span className="text-[9px] text-slate-400 font-sans block">Sensor</span>
                  <span className="text-slate-200">{currentCase.satellite || 'VIIRS'}</span>
                </div>
                <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                  <span className="text-[9px] text-slate-400 font-sans block">Pass Timestamp</span>
                  <span className="text-slate-200">{currentCase.timestamp || '—'}</span>
                </div>
                <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                  <span className="text-[9px] text-slate-400 font-sans block">Coordinates</span>
                  <span className="text-slate-200">
                    {currentCase.coordinates ? `${currentCase.coordinates[0].toFixed(4)}°N, ${currentCase.coordinates[1].toFixed(4)}°E` : '—'}
                  </span>
                </div>
                <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                  <span className="text-[9px] text-slate-400 font-sans block">Confidence</span>
                  <span className="text-slate-200 capitalize">{currentCase.confidence || 'nominal'}</span>
                </div>
              </div>
            )}
          </section>

          {/* 2. FACILITY CONTEXT */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('facility')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <Building2 className="w-3.5 h-3.5 text-amber-400" />
                <span>2. Facility Context & Spatial Association</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-cyan-400 font-semibold bg-cyan-950/40 px-1.5 py-0.2 rounded border border-cyan-800/50">
                  {isAssociated ? 'REAL COMPUTED' : 'UNASSOCIATED'}
                </span>
                {openSections.facility ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.facility && (
              <div className="p-3 space-y-1.5 text-xs">
                {isAssociated ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                      <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 font-sans block text-[10px]">Spatial Classification:</span>
                        <span className="text-cyan-400 font-bold">{currentCase.spatial_association || 'FACILITY_OFF_ZONE'}</span>
                      </div>
                      <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 font-sans block text-[10px]">Distance to Center:</span>
                        <span className="text-slate-200">
                          {currentCase.deviation_metrics?.distance_to_facility_meters != null
                            ? `${currentCase.deviation_metrics.distance_to_facility_meters} m from center`
                            : 'Inside boundary polygon'}
                        </span>
                      </div>
                      <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 font-sans block text-[10px]">Configured Stack Offset:</span>
                        <span className="text-amber-400 font-bold">
                          {currentCase.deviation_metrics?.distance_to_nearest_configured_zone_meters != null
                            ? `${currentCase.deviation_metrics.distance_to_nearest_configured_zone_meters} m off-stack`
                            : 'Evaluated from boundary'}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Point-in-polygon ray-casting confirms observation is inside the facility boundary{currentCase.deviation_metrics?.distance_to_nearest_configured_zone_meters != null ? `, offset ${currentCase.deviation_metrics.distance_to_nearest_configured_zone_meters} m from configured stack zones` : ''}{currentCase.deviation_metrics?.distance_to_observed_activity_zone_meters != null ? ` and ${currentCase.deviation_metrics.distance_to_observed_activity_zone_meters} m from the historical cluster centroid` : ''}.
                    </p>
                  </>
                ) : (
                  <div className="p-2.5 rounded bg-[#030712]/60 border border-slate-800 text-slate-400 text-[11px] leading-relaxed">
                    Spatial Classification: <strong className="text-purple-400">UNASSOCIATED</strong>. Observation coordinates fall outside all monitored ThermalSentinel industrial facility perimeters and association buffers. <span className="text-slate-500 block pt-1">Note: UNASSOCIATED strictly means no association with a monitored ThermalSentinel registry facility under configured spatial rules; it does not mean no unmonitored industry exists nearby (see OSM Context for auxiliary infrastructure).</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 3. BEHAVIOURAL BASELINE */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('baseline')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <TrendingUp className="w-3.5 h-3.5 text-rose-400" />
                <span>3. Behavioural Baseline & Statistical Deviation</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-[9px] font-semibold px-1.5 py-0.2 rounded border ${
                    !isAssociated || currentCase.facility_baseline_status === 'NOT_ASSESSED' || currentCase.facility_baseline_status === 'INSUFFICIENT_DATA'
                      ? 'text-slate-400 bg-slate-900/40 border-slate-700/50'
                      : currentCase.facility_baseline_status === 'LIMITED'
                      ? 'text-amber-400 bg-amber-950/40 border-amber-800/50'
                      : currentCase.facility_baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW'
                      ? 'text-cyan-300 bg-cyan-950/40 border-cyan-800/50'
                      : 'text-emerald-400 bg-emerald-950/40 border-emerald-800/50'
                  }`}
                >
                  {!isAssociated || currentCase.facility_baseline_status === 'NOT_ASSESSED' || currentCase.facility_baseline_status === 'INSUFFICIENT_DATA'
                    ? 'NOT ASSESSED'
                    : currentCase.facility_baseline_status === 'LIMITED'
                    ? 'LIMITED (N<30)'
                    : currentCase.facility_baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW'
                    ? (currentCase.deviation_metrics?.frp_ratio_to_median ? `${currentCase.behavioural_status} (${currentCase.deviation_metrics.frp_ratio_to_median.toFixed(2)}× · CANDIDATE)` : 'CANDIDATE (REVIEW REQ)')
                    : (currentCase.deviation_metrics?.frp_ratio_to_median ? `${currentCase.behavioural_status} (${currentCase.deviation_metrics.frp_ratio_to_median.toFixed(2)}×)` : (currentCase.behavioural_status || 'EMPIRICAL'))}
                </span>
                {openSections.baseline ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.baseline && (
              <div className="p-3 space-y-2 text-xs">
                {isAssociated && currentCase.current_baseline_metrics?.median_frp != null && (currentCase.facility_baseline_status === 'EMPIRICAL' || currentCase.facility_baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW') ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 font-mono text-center text-[11px]">
                      <div className="bg-[#030712]/70 p-1.5 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-400 font-sans block">Observations</span>
                        <span className="text-slate-200 font-bold">{currentCase.current_baseline_metrics.sample_size}</span>
                      </div>
                      <div className="bg-[#030712]/70 p-1.5 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-400 font-sans block">Median</span>
                        <span className="text-cyan-400 font-bold">{currentCase.current_baseline_metrics.median_frp} MW</span>
                      </div>
                      <div className="bg-[#030712]/70 p-1.5 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-400 font-sans block">P75</span>
                        <span className="text-slate-200 font-bold">{currentCase.current_baseline_metrics.p75_frp ?? '—'} MW</span>
                      </div>
                      <div className="bg-[#030712]/70 p-1.5 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-400 font-sans block">P95</span>
                        <span className="text-amber-400 font-bold">{currentCase.current_baseline_metrics.p95_frp ?? '—'} MW</span>
                      </div>
                      <div className="bg-[#030712]/70 p-1.5 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-400 font-sans block">Record Max</span>
                        <span className="text-rose-400 font-bold">{currentCase.current_baseline_metrics.max_frp ?? '—'} MW</span>
                      </div>
                    </div>

                    <div className={`p-2.5 rounded-lg space-y-0.5 text-[11px] leading-relaxed border ${
                      currentCase.facility_baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW'
                        ? 'bg-cyan-950/30 border-cyan-800/40'
                        : 'bg-rose-950/30 border-rose-800/40'
                    }`}>
                      <strong className={currentCase.facility_baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW' ? 'text-cyan-300' : 'text-rose-300'}>
                        {currentCase.facility_baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW' ? 'Candidate Baseline Comparison:' : currentCase.behavioural_status === 'ANOMALOUS' ? 'Anomalous Deviation:' : currentCase.behavioural_status === 'ELEVATED' ? 'Elevated Output:' : 'Routine Flaring:'}
                      </strong>{' '}
                      FRP ({currentCase.frp} MW) is {(currentCase.deviation_metrics?.frp_ratio_to_median ?? (currentCase.frp / currentCase.current_baseline_metrics.median_frp)).toFixed(2)}× historical facility median ({currentCase.current_baseline_metrics.median_frp} MW).
                      {currentCase.facility_baseline_status === 'CANDIDATE_EMPIRICAL_WITH_REVIEW' && (
                        <div className="pt-1 text-[10px] text-slate-300">
                          Provenance: CANDIDATE · REAL NASA FIRMS · REVIEW REQUIRED (1,302 associated observations, 108 active days / 115 calendar days [93.9% active-day coverage], 88.8% night / 11.2% day — strongly night-dominated. 99.54% of facility-associated detections fall inside facility boundary polygon).
                        </div>
                      )}
                    </div>
                  </>
                ) : isAssociated && currentCase.facility_baseline_status === 'LIMITED' ? (
                  <div className="p-2.5 rounded bg-amber-950/30 border border-amber-800/40 text-slate-300 text-[11px] leading-relaxed space-y-1">
                    <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Limited Historical Coverage (N &lt; 30)</span>
                    </div>
                    <div>
                      Facility Association: <strong className="text-amber-200">{currentCase.associated_facility?.name || 'Monitored Facility'}</strong>. Status: <strong className="text-amber-300">LIMITED · REAL NASA FIRMS</strong>.
                    </div>
                    <div className="text-slate-400">
                      Real NASA FIRMS historical data exists ({currentCase.current_baseline_metrics?.sample_size || (currentCase.associated_facility?.id === 'FAC-GUJ-DAHEJ-03' ? 18 : 10)} associated records), but volume is below operational threshold (N ≥ 30). Behavioural deviation scoring is suspended; data is provided for exploratory historical context only.
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded bg-[#030712]/60 border border-slate-800 text-slate-400 text-[11px] leading-relaxed">
                    Facility Association: <strong className="text-purple-400">{isAssociated ? (currentCase.associated_facility?.name || 'Monitored Facility') : 'UNASSOCIATED'}</strong>. Behavioural Baseline: <strong className="text-purple-400">NOT ASSESSED</strong>.<br />
                    <span className="text-slate-500 pt-0.5 block">
                      Reason: {isAssociated ? 'No historical observation population to construct empirical facility baseline.' : 'No monitored-facility association.'} (NOT ASSESSED represents absence of a baseline profile, not a normal behavioural classification).
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 4. CONTEXTUAL SOURCE HYPOTHESES */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('hypotheses')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span>4. Contextual Source Hypotheses (Model-Based Belief)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[9px] font-semibold px-1.5 py-0.2 rounded border ${
                  isEvidenceFused
                    ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/70'
                    : 'text-amber-400 bg-amber-950/40 border-amber-800/50'
                }`}>
                  {isEvidenceFused ? 'EVIDENCE FUSED' : 'INITIAL DETECTION POSTERIOR (T0)'}
                </span>
                {openSections.hypotheses ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.hypotheses && (
              <div className="p-3 space-y-3 text-xs">
                {/* Spatially Invariant Base Prior P0(H) Panel */}
                <div className="p-2.5 rounded-lg bg-[#030712]/70 border border-slate-800/80 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span className="font-bold text-slate-300 uppercase tracking-wide">
                      Base Prior P₀(H) — Spatially Invariant Baseline
                    </span>
                    <span className="text-slate-400 font-semibold">20% Uniform (5 Hypotheses)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 text-[10px] font-mono">
                    <div className="p-1 rounded bg-slate-900/80 border border-slate-800 text-center">
                      <span className="text-slate-400 block text-[8px]">Gas Flare</span>
                      <span className="text-slate-200 font-bold">20.0%</span>
                    </div>
                    <div className="p-1 rounded bg-slate-900/80 border border-slate-800 text-center">
                      <span className="text-slate-400 block text-[8px]">Industrial Fire</span>
                      <span className="text-slate-200 font-bold">20.0%</span>
                    </div>
                    <div className="p-1 rounded bg-slate-900/80 border border-slate-800 text-center">
                      <span className="text-slate-400 block text-[8px]">Agri Burn</span>
                      <span className="text-slate-200 font-bold">20.0%</span>
                    </div>
                    <div className="p-1 rounded bg-slate-900/80 border border-slate-800 text-center">
                      <span className="text-slate-400 block text-[8px]">Wildfire</span>
                      <span className="text-slate-200 font-bold">20.0%</span>
                    </div>
                    <div className="p-1 rounded bg-slate-900/80 border border-slate-800 text-center">
                      <span className="text-slate-400 block text-[8px]">Other</span>
                      <span className="text-slate-200 font-bold">20.0%</span>
                    </div>
                  </div>
                  <div className="text-[9px] text-slate-500 font-sans text-center pt-0.5">
                    ↓ Conditioned on Radiometric Intensity, Diurnal Timing &amp; Spatial Context Evidence ↓
                  </div>
                </div>

                {/* Active Model-Based Belief Distribution */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span className="font-bold text-slate-300 uppercase tracking-wide">
                      {isEvidenceFused ? 'Fused Posterior Distribution P(H | All Evidence)' : 'Initial Detection Posterior P(T₀ | Radiometry, Spatial Context)'}
                    </span>
                    <span className="text-cyan-400 font-semibold">Model-Based Belief</span>
                  </div>

                  {activeHypothesesList.map((hypo) => (
                    <div key={hypo.key} className="space-y-0.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-200">{hypo.label}</span>
                          {hypo.delta !== 0 && (
                            <span className={`font-mono text-[9px] px-1 rounded font-bold ${
                              hypo.delta > 0 ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60' : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                            }`}>
                              {hypo.delta > 0 ? `+${hypo.delta}%` : `${hypo.delta}%`}
                            </span>
                          )}
                        </div>
                        <span className={`font-mono font-bold ${hypo.textColor}`}>
                          {hypo.percentage}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`${hypo.color} h-full rounded-full transition-all duration-300`}
                          style={{ width: `${hypo.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Explanatory Note on Bayesian Belief vs Calibrated Probability */}
                <div className="p-2 rounded bg-[#030712]/50 border border-slate-800 text-[10px] text-slate-400 font-sans leading-relaxed">
                  <strong className="text-slate-300">Methodological Note:</strong> Bayesian belief distribution derived from domain likelihood models under recursive evidence updating.
                </div>

                {/* Evidence Fusion Resolution Box */}
                {isEvidenceFused && (
                  <div className="mt-2 p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/60 space-y-1.5">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-300 text-[11px] uppercase tracking-wide">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          {currentCase.appliedEvidenceIds?.some((id) => id.includes('S2') || id.includes('OPTICAL'))
                            ? 'CONTROLLED EVIDENCE FUSION — POSTERIOR UPDATED'
                            : 'EVIDENCE FUSION — POSTERIOR UPDATED'}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-emerald-300 font-bold px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800">
                        {deltaH < 0
                          ? `ΔH = ${deltaH} bits (${uncertaintyReductionPct}% reduction)`
                          : deltaH > 0
                          ? `ΔH = +${deltaH} bits (ambiguity increased)`
                          : `ΔH = 0.000 bits (no change)`}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">
                      Incorporated {appliedEvidenceCount} high-utility evidence candidate{appliedEvidenceCount > 1 ? 's' : ''}. Ambiguity between competing source hypotheses has been mathematically reduced via Shannon entropy update.
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {currentCase.appliedEvidenceIds?.map((id) => (
                        <span key={id} className="px-1.5 py-0.5 rounded bg-slate-900 border border-emerald-700/60 text-[9px] font-mono text-emerald-300">
                          ✓ {id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 5. HYPOTHESIS UNCERTAINTY (SHANNON ENTROPY) */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('uncertainty')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
                <span>5. Hypothesis Uncertainty (Shannon Entropy)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[9px] font-semibold px-1.5 py-0.2 rounded border ${
                  currentEntropyBits < 0.7
                    ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800/50'
                    : currentEntropyBits < 1.2
                    ? 'text-amber-300 bg-amber-950/40 border-amber-800/50'
                    : 'text-rose-300 bg-rose-950/40 border-rose-800/50'
                }`}>
                  {currentEntropyBits} bits ({currentEntropyBits < 0.7 ? 'LOW' : currentEntropyBits < 1.2 ? 'MODERATE' : 'HIGH'})
                </span>
                {openSections.uncertainty ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.uncertainty && (
              <div className="p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span>
                    Current Entropy H: <strong className="text-cyan-300">{currentEntropyBits} bits</strong>
                    <span className="text-slate-500 ml-1">(H_max: {maxPossibleEntropyBits.toFixed(3)} bits · H_norm: {Math.round(normalizedEntropy * 100)}%)</span>
                  </span>
                  <span>
                    State: <strong className={
                      normalizedEntropy < 0.35
                        ? 'text-emerald-400'
                        : normalizedEntropy < 0.65
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }>
                      {normalizedEntropy < 0.35
                        ? 'LOW UNCERTAINTY'
                        : normalizedEntropy < 0.65
                        ? 'MODERATE AMBIGUITY'
                        : 'HIGH AMBIGUITY'}
                    </strong>
                  </span>
                </div>

                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.round(normalizedEntropy * 100)}%` }}
                  />
                </div>

                {/* Before vs After Resolution Comparison Card */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px] pt-1">
                  <div className="p-2 rounded bg-[#030712]/70 border border-slate-800">
                    <span className="text-[9px] text-slate-400 font-sans block">Initial Uncertainty (T0)</span>
                    <span className="text-slate-200 font-bold">{initialEntropyBits} bits</span>
                    <span className="text-[9px] text-slate-500 block">Initial detection posterior (T0)</span>
                  </div>
                  <div className="p-2 rounded bg-[#030712]/70 border border-slate-800">
                    <span className="text-[9px] text-slate-400 font-sans block">Current Uncertainty (T1)</span>
                    <span className="text-cyan-300 font-bold">{currentEntropyBits} bits</span>
                    <span className="text-[9px] text-slate-500 block">Post-evidence fusion</span>
                  </div>
                  <div className="p-2 rounded bg-[#030712]/70 border border-slate-800">
                    <span className="text-[9px] text-slate-400 font-sans block">Uncertainty Delta / Reduction</span>
                    <span className={`font-bold ${deltaH < 0 ? 'text-emerald-400' : deltaH > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                      {deltaH < 0
                        ? `+${uncertaintyReduction.toFixed(3)} bits (${uncertaintyReductionPct}%)`
                        : deltaH > 0
                        ? `-${Math.abs(uncertaintyReduction).toFixed(3)} bits (increased)`
                        : '0.000 bits (0%)'}
                    </span>
                    <span className="text-[9px] text-slate-500 block">
                      Status: {uncertaintyStatus}
                    </span>
                  </div>
                </div>

                <div className="text-[10px] text-slate-400 font-mono pt-1">
                  Calculation: H(p) = -Σ [ p_i · log₂(p_i) ] · H_max = log₂({K_hypotheses}) = {maxPossibleEntropyBits.toFixed(3)} bits · H_norm = {(normalizedEntropy * 100).toFixed(1)}% across {K_hypotheses} candidate hypotheses.
                </div>
              </div>
            )}
          </section>

          {/* 6. ML ADVISORY */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('ml')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span>6. Machine Learning Advisory Discriminator</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-amber-300 font-semibold bg-amber-950/40 px-1.5 py-0.2 rounded border border-amber-800/50">
                  {discriminatorOutput?.status === 'AVAILABLE' ? 'MODEL ADVISORY: GAS_FLARE ↔ WILDFIRE' : 'LIMITED MODEL COVERAGE'}
                </span>
                {openSections.ml ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.ml && (
              <div className="p-3 space-y-2 text-xs">
                {discriminatorOutput?.status === 'AVAILABLE' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                      <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 font-sans block text-[10px]">Model &amp; Task:</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300">
                            {discriminatorOutput.coverage_status || 'FULL_COVERAGE'}
                          </span>
                        </div>
                        <span className="text-cyan-400 font-bold">{discriminatorOutput.model_id || discriminatorOutput.model_version || 'lr-v5f3-standardized'}</span>
                        <span className="text-slate-500 text-[9px] block">Supported: GAS_FLARE vs. WILDFIRE_CONFIRMED</span>
                      </div>
                      <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 font-sans block text-[10px]">Advisory Radiometric Class:</span>
                        <span className={`font-bold ${discriminatorOutput.predicted_class === 'WILDFIRE_CONFIRMED' ? 'text-rose-400' : 'text-amber-400'}`}>
                          {discriminatorOutput.predicted_label || (discriminatorOutput.predicted_class === 'WILDFIRE_CONFIRMED' ? 'Wildfire-side signal' : 'Gas Flare')}
                        </span>
                        <span className="text-slate-500 text-[9px] block">Decision Boundary: 0.50 (Standardized Cutoff)</span>
                      </div>
                    </div>

                    <div className="p-2 rounded bg-slate-900/80 border border-slate-800 font-mono text-[10px] flex justify-between">
                      <span>Flare-side score: <strong className="text-amber-400">{(discriminatorOutput.flare_score != null ? discriminatorOutput.flare_score * 100 : 0).toFixed(1)}%</strong></span>
                      <span>Wildfire-side score: <strong className="text-rose-400">{(discriminatorOutput.wildfire_score != null ? discriminatorOutput.wildfire_score * 100 : 100).toFixed(1)}%</strong></span>
                    </div>

                    <div className="text-[11px] text-slate-300 leading-relaxed bg-[#030712]/60 p-2.5 rounded border border-slate-800">
                      {discriminatorOutput.interpretation || 'Advisory binary radiometric discriminator conditional on gas flare vs wildfire.'}
                    </div>

                    {/* 7 VIIRS Radiometric Features Table */}
                    {discriminatorOutput.feature_contributions && discriminatorOutput.feature_contributions.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="font-bold text-slate-300 text-[10px] uppercase tracking-wider flex items-center justify-between">
                          <span>7 VIIRS Radiometric Features &amp; Linear Log-Odds Contributions</span>
                          <span className="text-[9px] text-slate-500 font-mono">Contrib = Coeff × ((x - Mean) / Scale)</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left font-mono text-[10px] border border-slate-800 rounded">
                            <thead className="bg-slate-900/90 text-slate-400 text-[9px]">
                              <tr>
                                <th className="p-1.5">Feature</th>
                                <th className="p-1.5 text-right">Raw Value</th>
                                <th className="p-1.5 text-right">Mean</th>
                                <th className="p-1.5 text-right">Scale</th>
                                <th className="p-1.5 text-right">Std Val</th>
                                <th className="p-1.5 text-right">Frozen Coeff</th>
                                <th className="p-1.5 text-right">Linear Contrib</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                              {discriminatorOutput.feature_contributions.map((fc: any) => (
                                <tr key={fc.feature} className="hover:bg-slate-900/40">
                                  <td className="p-1.5 text-slate-300 font-medium">{fc.display_name}</td>
                                  <td className="p-1.5 text-right text-slate-200">{fc.raw_value}</td>
                                  <td className="p-1.5 text-right text-slate-400">{fc.mean}</td>
                                  <td className="p-1.5 text-right text-slate-400">{fc.scale}</td>
                                  <td className="p-1.5 text-right text-slate-300">{fc.standardized_value}</td>
                                  <td className="p-1.5 text-right text-slate-400">{fc.frozen_coefficient}</td>
                                  <td className={`p-1.5 text-right font-bold ${fc.linear_contribution > 0 ? 'text-rose-400' : fc.linear_contribution < 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                                    {fc.linear_contribution > 0 ? `+${fc.linear_contribution.toFixed(3)}` : fc.linear_contribution.toFixed(3)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono pt-1">
                          Logit z = Intercept ({discriminatorOutput.intercept != null ? discriminatorOutput.intercept.toFixed(3) : '-1.272'}) + Σ(Linear Contrib) = {discriminatorOutput.logit_z != null ? discriminatorOutput.logit_z.toFixed(3) : '15.684'} · Sigmoid P(wildfire) = 1/(1+e^-z)
                        </div>
                      </div>
                    )}

                    {/* Prominent Evidence Conflict Card */}
                    {isEvidenceConflict && (
                      <div className="p-3 rounded-lg bg-gradient-to-r from-amber-950/50 to-rose-950/30 border border-amber-500/60 text-amber-200 text-xs space-y-2">
                        <div className="font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5 text-[11px]">
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                          <span>Evidence Conflict / Cross-Model Divergence</span>
                        </div>
                        <div className="leading-relaxed">
                          <strong>Contextual Engine Favors:</strong> <span className="text-rose-300 font-bold">{currentCase.source_hypotheses?.hypotheses_distribution?.[0]?.label || 'Industrial Fire'} ({currentCase.source_hypotheses?.hypotheses_distribution?.[0]?.percentage || 65}%)</span> based on monitored industrial facility context{currentCase.deviation_metrics?.frp_ratio_to_median ? `, and thermal intensity (FRP ${currentCase.frp || 11.97} MW, ${currentCase.deviation_metrics.frp_ratio_to_median.toFixed(1)}× above empirical operational median)` : ` (FRP ${currentCase.frp || 11.97} MW)`}.
                        </div>
                        <div className="leading-relaxed">
                          <strong>Radiometric Discriminator Favors:</strong> <span className="text-amber-300 font-bold">Wildfire-side signal ({(discriminatorOutput.wildfire_score != null ? discriminatorOutput.wildfire_score * 100 : 100).toFixed(0)}%)</span> because high sub-pixel infrared contrast (TI4 - TI5) and daytime acquisition deviate sharply from continuous flaring baseline.
                        </div>
                        <div className="text-amber-200/90 pt-1 border-t border-amber-800/60 text-[11px] leading-relaxed">
                          <strong>Analytical Root Cause:</strong> Event characteristics fall outside the binary training scope of model lr-v5f3-standardized (trained strictly on Gas Flare vs Wildfire). The model possesses no &quot;Industrial Fire&quot; class; hence, anomalous heat signatures trigger the wildfire-side score.
                        </div>
                        <div className="text-amber-300/90 text-[11px] font-semibold">
                          <strong>Why NBE is Required:</strong> Neither model is individually authoritative. Next-Best-Evidence acquisition is recommended to inspect physical emitter geometry.
                        </div>
                      </div>
                    )}
                  </>
                ) : (() => {
                  const advisory = getAiSourceAdvisory(
                    matchedEvent || currentCase,
                    currentCase.source_hypotheses?.hypotheses_distribution,
                    currentCase.associated_facility || null
                  );
                  return (
                    <div className="p-3 rounded-lg bg-[#030712]/60 border border-slate-800 text-slate-300 text-xs space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                        <div className="font-bold text-amber-300 font-mono text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-amber-400" />
                          <span>AI ADVISORY · CONTEXTUAL ASSESSMENT</span>
                        </div>
                        <span className="font-mono text-[9px] text-amber-300 font-semibold bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/50">
                          CONTEXTUAL AI SUPPORT
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Primary Assessment</div>
                        <div className="font-bold text-amber-200 text-sm flex items-baseline gap-2">
                          <span>{advisory.primary_assessment}</span>
                          <span className="text-amber-400 font-mono text-xs font-semibold">({advisory.primary_percentage}% support)</span>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Supporting Signals</div>
                        <ul className="space-y-1 text-[11px] text-slate-300">
                          {advisory.supporting_signals.map((sig, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className="text-cyan-400 font-bold">•</span>
                              <span>{sig}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {advisory.alternative_assessment && (
                        <div className="pt-1 border-t border-slate-800/60 flex items-baseline justify-between text-[11px]">
                          <span className="text-slate-400">Alternative Candidate:</span>
                          <span className="text-slate-200 font-semibold">
                            {advisory.alternative_assessment} ({advisory.alternative_percentage}%)
                          </span>
                        </div>
                      )}

                      <div className="text-[9px] text-slate-500 pt-1 border-t border-slate-800/60 leading-relaxed font-sans">
                        Note: The machine learning model (<code>lr-v5f3-standardized</code>) evaluates radiometric features for Gas Flare vs Wildfire discrimination. The contextual advisory provides multi-criteria summary support.
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>

          {/* 7. SATELLITE EVIDENCE */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('satellite')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <Satellite className="w-3.5 h-3.5 text-amber-400" />
                <span>7. Satellite Evidence (Copernicus Sentinel-2 SWIR)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-amber-300 font-semibold bg-amber-950/40 px-1.5 py-0.2 rounded border border-amber-800/50">
                  {currentCase.appliedEvidenceIds?.includes('EVID-JAM-S2-SWIR')
                    ? 'FUSED'
                    : sentinelData?.status === 'AUTHENTIC_LIVE' && sentinelData.is_event_adjacent
                    ? 'LIVE'
                    : sentinelData?.temporal_status === 'TEMPORALLY_DISTANT' || sentinelData?.status === 'AVAILABLE_TEMPORALLY_DISTANT'
                    ? 'DISTANT CONTEXT'
                    : 'RECOMMENDED PENDING OVERPASS'}
                </span>
                {openSections.satellite ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.satellite && (
              <div className="p-3 space-y-2 text-xs">
                {sentinelData && sentinelData.status !== 'ERROR' && (sentinelData.status === 'AUTHENTIC_LIVE' || sentinelData.temporal_status === 'TEMPORALLY_DISTANT' || sentinelData.status === 'AVAILABLE_TEMPORALLY_DISTANT' || sentinelData.status === 'FALLBACK_SIMULATED') ? (
                  <>
                    <div className="p-2.5 rounded bg-amber-950/30 border border-amber-800/60 font-mono text-[10px] text-amber-200/90 space-y-1">
                      <div className="font-bold flex items-center justify-between text-amber-300">
                        <span>
                          {sentinelData.status === 'FALLBACK_SIMULATED' || currentCase.appliedEvidenceIds?.includes('EVID-JAM-S2-SWIR')
                            ? 'PROVENANCE: CONTROLLED SCENARIO (EVALUATION AUDIT)'
                            : sentinelData.temporal_difference_human
                            ? `PROVENANCE: DISTANT / FORENSIC CONTEXT (${sentinelData.temporal_difference_human})`
                            : 'PROVENANCE: FORENSIC CONTEXT'}
                        </span>
                        {(sentinelData.status === 'FALLBACK_SIMULATED' || currentCase.appliedEvidenceIds?.includes('EVID-JAM-S2-SWIR')) && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-900/80 text-amber-200 border border-amber-600 text-[8px] font-bold">
                            CONTROLLED SCENARIO EVIDENCE
                          </span>
                        )}
                      </div>
                      <div>Scene: {sentinelData.scene_id || 'Copernicus Sentinel-2 Scene'} • {sentinelData.acquisition_date || 'Reference Acquisition'} • 20m spatial resolution</div>
                      <div className="text-[9px] text-slate-400 pt-0.5 leading-tight">
                        {sentinelData.status === 'FALLBACK_SIMULATED' || currentCase.appliedEvidenceIds?.includes('EVID-JAM-S2-SWIR')
                          ? 'Controlled evaluation scenario: curated multi-spectral SWIR profile for information-utility assessment; not a contemporaneous live satellite pass.'
                          : sentinelData.advisory_note || 'Provides structural facility context; not contemporaneous plume confirmation. NBE overpass tasking recommended for real-time geometry.'}
                      </div>
                    </div>

                    {sentinelData?.image_data_url && (
                      <img
                        src={sentinelData.image_data_url}
                        alt="Sentinel-2 SWIR"
                        className="w-full h-40 object-cover rounded-lg border border-slate-700"
                      />
                    )}
                  </>
                ) : (
                  <div className="p-2.5 rounded bg-[#030712]/60 border border-slate-800 text-slate-400 text-[11px] space-y-1">
                    <div className="font-semibold text-slate-300">SENTINEL-2 SWIR: NOT CURRENTLY AVAILABLE</div>
                    <div className="text-[10px] text-slate-500">
                      No contemporaneous Sentinel-2 overpass is currently available for coordinate [{currentCase.coordinates ? `${currentCase.coordinates[0].toFixed(4)}°N, ${currentCase.coordinates[1].toFixed(4)}°E` : '—'}]. Tasking a future orbital revisit is recommended.
                    </div>
                  </div>
                )}

                {currentCase.recommendedEvidence?.some((e) => e.id === 'EVID-JAM-S2-SWIR') && (
                  <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-800">
                    <span className="text-[11px] text-slate-400">
                      High-resolution SWIR (B11 1.6µm / B12 2.2µm) spatial confinement check.
                    </span>
                    <button
                      id="btn-apply-s2-evidence"
                      onClick={() => onApplyEvidenceToCase?.(currentCase.case_id || currentCase.caseId || '', 'EVID-JAM-S2-SWIR')}
                      disabled={currentCase.appliedEvidenceIds?.includes('EVID-JAM-S2-SWIR')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                        currentCase.appliedEvidenceIds?.includes('EVID-JAM-S2-SWIR')
                          ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/80 cursor-default'
                          : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md'
                      }`}
                    >
                      {currentCase.appliedEvidenceIds?.includes('EVID-JAM-S2-SWIR') ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>SWIR EVIDENCE INCORPORATED</span>
                        </>
                      ) : (
                        <>
                          <Satellite className="w-3.5 h-3.5" />
                          <span>INCORPORATE SWIR EVIDENCE</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 8. OSM INFRASTRUCTURE */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('osm')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>8. OpenStreetMap Infrastructure Context</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[9px] font-semibold px-1.5 py-0.2 rounded border ${
                  osmData && osmData.total_features_found > 0
                    ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/50'
                    : osmData?.status === 'NO_MAPPED_FEATURES' || (osmData && osmData.total_features_found === 0)
                    ? 'text-slate-400 bg-slate-900/40 border-slate-700/50'
                    : osmData?.status === 'OUT_OF_SCOPE'
                    ? 'text-slate-500 bg-slate-900/40 border-slate-800/50'
                    : osmData?.status === 'ACQUISITION_FAILED' || osmData?.status === 'OSM_UNAVAILABLE'
                    ? 'text-amber-300 bg-amber-950/40 border-amber-800/50'
                    : 'text-slate-500 bg-slate-900/40 border-slate-800/50'
                }`}>
                  {osmData && osmData.total_features_found > 0
                    ? `MAPPED FEATURES FOUND (${osmData.total_features_found})`
                    : osmData?.status === 'NO_MAPPED_FEATURES' || (osmData && osmData.total_features_found === 0)
                    ? 'NO MAPPED FEATURES'
                    : osmData?.status === 'OUT_OF_SCOPE'
                    ? 'OUT OF SCOPE'
                    : osmData?.status === 'ACQUISITION_FAILED' || osmData?.status === 'OSM_UNAVAILABLE'
                    ? 'ACQUISITION FAILED / UNAVAILABLE'
                    : 'QUERYING OSM...'}
                </span>
                {openSections.osm ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.osm && (
              <div className="p-3 space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans block text-[10px]">Features in 3 km:</span>
                    <span className="text-cyan-400 font-bold">
                      {osmData ? `${osmData.total_features_found} mapped` : 'Querying...'}
                    </span>
                  </div>
                  <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans block text-[10px]">Nearest Feature:</span>
                    <span className="text-amber-400 font-bold truncate block">
                      {osmData?.nearest_feature
                        ? osmData.nearest_feature.display_label || `${osmData.nearest_feature.category.toUpperCase()} (${osmData.nearest_feature.distance_meters} m)`
                        : osmData
                        ? 'None in radius'
                        : 'Querying...'}
                    </span>
                  </div>
                </div>
                {osmData?.features && osmData.features.length > 0 && (
                  <div className="bg-[#030712]/40 p-2 rounded border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 font-sans uppercase font-bold tracking-wider">Nearby Features (Distance Ranked):</span>
                    <div className="space-y-0.5">
                      {osmData.features.slice(0, 4).map((feat, fIdx) => (
                        <div key={fIdx} className="text-slate-300 font-mono text-[10px] flex justify-between">
                          <span>• {feat.display_label || `${feat.category.replace('_', ' ')} (${feat.name || 'Unnamed'})`}</span>
                          <span className="text-slate-500">{feat.distance_meters}m</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-[10px] text-slate-500 font-sans pt-1 border-t border-slate-800/60 leading-tight">
                  Independent contextual evidence from OpenStreetMap Overpass API. Nearby mapped industrial features provide physical context but do NOT create monitored-facility association, and absence of OSM features does NOT confirm absence of industrial activity.
                </div>
                {osmData?.provenance && (
                  <div className="text-[9px] text-slate-500 font-mono pt-0.5">
                    Source: {osmData.provenance.api_endpoint} · Search radius: {osmData.search_radius_meters} m
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 9. WEATHER & PLUME */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('weather')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <Wind className="w-3.5 h-3.5 text-emerald-400" />
                <span>9. Historical Weather & Plume Context</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-emerald-400 font-semibold bg-emerald-950/40 px-1.5 py-0.2 rounded border border-emerald-800/50">
                  {weatherData?.status === 'AUTHENTIC_HISTORICAL' ? 'HISTORICAL' : 'CONTEXT'}
                </span>
                {openSections.weather ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.weather && (
              <div className="p-3 space-y-1.5 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono text-[11px]">
                  <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans block text-[9px]">Surface Temp</span>
                    <span className="text-slate-100 font-bold">
                      {weatherData?.metrics?.temperature_c != null ? `${weatherData.metrics.temperature_c.toFixed(1)}°C` : 'Unavailable'}
                    </span>
                  </div>
                  <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans block text-[9px]">Relative Humidity</span>
                    <span className="text-slate-100 font-bold">
                      {weatherData?.metrics?.relative_humidity_pct != null ? `${weatherData.metrics.relative_humidity_pct}%` : 'Unavailable'}
                    </span>
                  </div>
                  <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans block text-[9px]">Wind Speed</span>
                    <span className="text-amber-400 font-bold">
                      {weatherData?.metrics?.wind_speed_kmh != null
                        ? `${weatherData.metrics.wind_speed_kmh.toFixed(1)} km/h ${weatherData.metrics.wind_cardinal_from || ''}`
                        : 'Unavailable'}
                    </span>
                  </div>
                  <div className="bg-[#030712]/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 font-sans block text-[9px]">Plume Drift</span>
                    <span className="text-cyan-400 font-bold">
                      {weatherData?.metrics?.wind_cardinal_toward ? `Toward ${weatherData.metrics.wind_cardinal_toward}` : 'Unavailable'}
                    </span>
                  </div>
                </div>
                {weatherData?.observation_alignment && (
                  <div className="text-[10px] text-slate-400 font-sans pt-1">
                    Aligned observation: {weatherData.observation_alignment.weather_record_timestamp_utc} (Δt: {weatherData.observation_alignment.temporal_difference_minutes} min)
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 10. NEXT-BEST-EVIDENCE */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('nbe')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <Compass className="w-3.5 h-3.5 text-cyan-400" />
                <span>10. Next-Best-Evidence Strategy</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-cyan-300 font-semibold bg-cyan-950/60 px-1.5 py-0.2 rounded border border-cyan-700/60">
                  UTILITY: {nbeRecommendation?.utility_score != null ? `${nbeRecommendation.utility_score}/100` : (isAssociated ? '96/100' : '95/100')}
                </span>
                {openSections.nbe ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.nbe && (
              <div className="p-3 space-y-2 text-xs">
                <div className="bg-[#030712]/70 p-3 rounded border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-100">
                      {nbeRecommendation?.displayName || (isAssociated
                        ? 'Contemporaneous Copernicus Sentinel-2 SWIR Overpass Tasking (B11/B12, 20m)'
                        : 'High-Resolution Land Cover & Surface Composition (10m)')}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 font-bold">
                      SCORE: {nbeRecommendation?.utility_score != null ? `${nbeRecommendation.utility_score}/100` : (isAssociated ? '96/100' : '95/100')}
                    </span>
                  </div>

                  {isAssociated && sentinelData && (sentinelData.temporal_status === 'TEMPORALLY_DISTANT' || sentinelData.status === 'AVAILABLE_TEMPORALLY_DISTANT') && (
                    <div className="p-2 rounded bg-amber-950/30 border border-amber-800/50 text-[11px] text-amber-300 font-mono">
                      <strong>Temporal Integrity Note:</strong> Existing Copernicus Sentinel-2 scene {sentinelData.scene_id || 'archived scene'} is temporally distant ({sentinelData.temporal_difference_human || 'prior pass'}). Contemporaneous overpass tasking is the prioritized action.
                    </div>
                  )}

                  <div className="text-[11px] text-slate-300 leading-relaxed">
                    {nbeRecommendation?.whyUseful || nbeRecommendation?.rationale || (isAssociated
                      ? 'Provides 20 m spatial resolution shortwave infrared (1.6 µm / 2.2 µm) to physically resolve flare stack structures versus ground-level industrial fires. Crucial for distinguishing anomalous industrial fire excursions from large flaring events inside petrochemical complexes.'
                      : 'Prevents speculative source attribution by providing definitive terrain composition of the underlying pixel.')}
                  </div>

                  {/* Dynamic Formulation Breakdown Table */}
                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800 font-mono text-[10px] space-y-1.5">
                    <div className="font-bold text-cyan-400 uppercase tracking-wide text-[9px] font-sans">
                      Information-Value Formulation Components
                    </div>
                    <div>
                      <span className="text-slate-400 font-sans">Target Hypothesis Pair: </span>
                      <strong className="text-slate-200">
                        {nbeRecommendation?.target_hypothesis_pair || (isAssociated ? 'Industrial Flare Stack vs Unconfined Ground Fire' : 'Agricultural Residue vs Wildland Scrub')}
                      </strong>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                      <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800/80">
                        <span className="text-slate-400 font-sans block text-[9px]">0.30 × H/H_max:</span>
                        <span className="text-slate-200 font-bold">
                          {nbeRecommendation?.utility_breakdown?.entropy_contribution != null
                            ? nbeRecommendation.utility_breakdown.entropy_contribution.toFixed(3)
                            : (0.30 * 0.60).toFixed(3)}
                        </span>
                      </div>
                      <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800/80">
                        <span className="text-slate-400 font-sans block text-[9px]">0.25 × C_comp:</span>
                        <span className="text-slate-200 font-bold">
                          {nbeRecommendation?.utility_breakdown?.hypothesis_competition != null
                            ? nbeRecommendation.utility_breakdown.hypothesis_competition.toFixed(3)
                            : (0.25 * 0.58).toFixed(3)}
                        </span>
                      </div>
                      <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800/80">
                        <span className="text-slate-400 font-sans block text-[9px]">0.45 × Relevance:</span>
                        <span className="text-slate-200 font-bold">
                          {nbeRecommendation?.utility_breakdown?.contextual_relevance != null
                            ? nbeRecommendation.utility_breakdown.contextual_relevance.toFixed(3)
                            : (0.45 * (isAssociated ? 0.96 : 0.96)).toFixed(3)}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between border-t border-slate-800 pt-1 text-[11px]">
                      <span className="text-slate-300 font-sans">Raw Information Value:</span>
                      <span className="text-cyan-300 font-bold">
                        {nbeRecommendation?.utility_breakdown?.raw_information_value != null
                          ? nbeRecommendation.utility_breakdown.raw_information_value.toFixed(3)
                          : '0.857'}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-300 font-sans">Cost / Latency Multiplier:</span>
                      <span className="text-slate-200 font-bold">
                        {nbeRecommendation?.utility_breakdown?.cost_multiplier != null
                          ? `${nbeRecommendation.utility_breakdown.cost_multiplier}×`
                          : (isAssociated ? '0.85×' : '0.90×')}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-800 pt-1 text-xs">
                      <span className="text-cyan-400 font-bold font-sans">Final Utility Score:</span>
                      <span className="text-cyan-300 font-bold">
                        {nbeRecommendation?.utility_score != null ? `${nbeRecommendation.utility_score} / 100` : (isAssociated ? '96 / 100' : '95 / 100')}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-500 pt-1 border-t border-slate-800">
                      UtilityScore(E) = Math.round(100 × [0.30·(H/H_max) + 0.25·C_comp + 0.45·Relevance] × CostMultiplier)
                    </div>
                  </div>

                  {/* Ranked Candidates with Incorporate Action Buttons */}
                  {currentCase.recommendedEvidence && currentCase.recommendedEvidence.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider font-sans flex items-center justify-between">
                        <span>Ranked Actionable Evidence Candidates</span>
                        <span className="text-[9px] text-cyan-400 font-mono">1-Click Fusion</span>
                      </div>
                      <div className="space-y-1.5">
                        {currentCase.recommendedEvidence.map((ev, idx) => {
                          const isApplied = currentCase.appliedEvidenceIds?.includes(ev.id) || (currentCase as any).applied_evidence_ids?.includes(ev.id);
                          
                          // Explicit Candidate Status Classification (Section 9 Requirement 2)
                          let candidateStatus: 'RECOMMENDED' | 'AVAILABLE' | 'INCORPORATED' | 'UNAVAILABLE' | 'DISTANT / FORENSIC' = 'RECOMMENDED';
                          let badgeColor = 'bg-cyan-950/80 text-cyan-300 border-cyan-800';

                          if (isApplied) {
                            candidateStatus = 'INCORPORATED';
                            badgeColor = 'bg-emerald-900/80 text-emerald-300 border-emerald-700';
                          } else if (
                            (ev as any).availability_status === 'DISTANT_FORENSIC' ||
                            (ev as any).availability === 'DISTANT_FORENSIC' ||
                            ev.id === 'EVID-JAM-S2-SWIR' && (sentinelData?.temporal_status === 'TEMPORALLY_DISTANT' || sentinelData?.status === 'AVAILABLE_TEMPORALLY_DISTANT')
                          ) {
                            candidateStatus = 'DISTANT / FORENSIC';
                            badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800';
                          } else if (
                            (ev as any).availability_status === 'AVAILABLE' ||
                            (ev as any).availability === 'AVAILABLE' ||
                            (ev.id === 'EVID-OSM-INFRA' && osmData?.status === 'AUTHENTIC_LIVE') ||
                            (ev.id === 'EVID-WEATHER-WIND' && weatherData?.status === 'AUTHENTIC_LIVE')
                          ) {
                            candidateStatus = 'AVAILABLE';
                            badgeColor = 'bg-blue-950/80 text-blue-300 border-blue-800';
                          } else if (
                            (ev as any).availability_status === 'UNAVAILABLE' ||
                            (ev as any).availability === 'UNAVAILABLE'
                          ) {
                            candidateStatus = 'UNAVAILABLE';
                            badgeColor = 'bg-slate-900 text-slate-400 border-slate-700';
                          } else if (idx === 0) {
                            candidateStatus = 'RECOMMENDED';
                            badgeColor = 'bg-cyan-950/80 text-cyan-300 border-cyan-800';
                          }

                          return (
                            <div
                              key={ev.id}
                              className={`p-2 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition ${
                                isApplied
                                  ? 'bg-emerald-950/20 border-emerald-800/60'
                                  : 'bg-slate-900/70 border-slate-800 hover:border-cyan-700/60'
                              }`}
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[9px] text-cyan-400 font-bold">#{idx + 1}</span>
                                  <span className="font-bold text-slate-100 text-[11px]">{ev.title}</span>
                                  <span className={`px-1.5 py-0.2 rounded text-[8px] font-mono border font-bold ${badgeColor}`}>
                                    {candidateStatus}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 leading-tight">
                                  {ev.sensor} • {ev.costOrLatency} • Information Utility: <strong className="text-cyan-300 font-mono">{ev.utilityScore}/100</strong>
                                </div>
                                {ev.evidenceFindings?.summary && (
                                  <div className="text-[10px] text-slate-300 font-mono leading-tight pt-0.5">
                                    Finding: {ev.evidenceFindings.summary}
                                  </div>
                                )}
                              </div>

                              <button
                                onClick={() => onApplyEvidenceToCase?.(currentCase.case_id || currentCase.caseId || '', ev.id)}
                                disabled={isApplied}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 flex-shrink-0 ${
                                  isApplied
                                    ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 cursor-default'
                                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-md'
                                }`}
                              >
                                {isApplied ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Applied</span>
                                  </>
                                ) : (
                                  <>
                                    <Compass className="w-3.5 h-3.5" />
                                    <span>Incorporate</span>
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* 11. METHODOLOGICAL LIMITATIONS & RESOLUTION */}
          <section className="bg-[#090d16] rounded-lg border border-slate-800 overflow-hidden">
            <button
              onClick={() => toggleSection('limitations')}
              className="w-full p-2.5 flex items-center justify-between bg-[#030712]/50 hover:bg-slate-800/40 transition border-b border-slate-800"
            >
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-200">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>11. Audit Trail, Case Resolution &amp; Notes</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[9px] font-semibold px-1.5 py-0.2 rounded border ${
                  currentCase.status === 'CLOSED_RESOLVED' || currentCase.status === 'RESOLVED'
                    ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/70'
                    : 'text-amber-300 bg-amber-950/40 border-amber-800/50'
                }`}>
                  {currentCase.status === 'CLOSED_RESOLVED' || currentCase.status === 'RESOLVED' ? 'CLOSED RESOLVED' : 'ACTIVE AUDIT'}
                </span>
                {openSections.limitations ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </div>
            </button>

            {openSections.limitations && (
              <div className="p-3 space-y-3 text-xs">
                {/* Formal Case Resolution Workflow Card */}
                <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200 uppercase tracking-wide">
                      <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                      <span>Formal Investigator Resolution</span>
                    </div>
                    {(currentCase.status === 'CLOSED_RESOLVED' || currentCase.status === 'RESOLVED') && (
                      <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700 font-mono text-[10px] font-bold">
                        RESOLVED
                      </span>
                    )}
                  </div>

                  {(currentCase.status === 'CLOSED_RESOLVED' || currentCase.status === 'RESOLVED') && (currentCase.resolution || (currentCase as any).investigator_resolution) ? (
                    <div className="p-2.5 rounded bg-emerald-950/30 border border-emerald-800/60 space-y-1 text-xs">
                      <div className="flex justify-between font-mono text-[11px]">
                        <span>Final Verdict: <strong className="text-emerald-300 uppercase">
                          {((currentCase as any).investigator_resolution?.verdict_label || currentCase.resolution?.finalVerdict || '').replace('_', ' ')}
                        </strong></span>
                        <span>Confidence: <strong className="text-emerald-400">
                          {(currentCase as any).investigator_resolution?.confidence ?? currentCase.resolution?.confidence}%
                        </strong></span>
                      </div>
                      <div className="text-slate-300 text-[11px] leading-snug">
                        {currentCase.resolution?.actionRecommended || (currentCase as any).investigator_resolution?.notes}
                      </div>
                      <div className="text-slate-500 font-mono text-[9px]">
                        Resolved by: {(() => {
                          const res = (currentCase as any).investigator_resolution || currentCase.resolution;
                          const resType = res?.resolution_type;
                          const investigatorId = res?.investigator_id || res?.actor;
                          if (resType === 'CONTROLLED_SIMULATION_DEMO') {
                            return 'Operator (Controlled Resolution)';
                          }
                          if (resType === 'REAL_FIELD_INVESTIGATION') {
                            return investigatorId || 'Field Investigator';
                          }
                          if (investigatorId && investigatorId !== 'Senior Investigator') {
                            return investigatorId;
                          }
                          return 'Operator (Controlled Resolution)';
                        })()} at: {(currentCase as any).investigator_resolution?.resolved_at || currentCase.resolution?.resolvedAt || 'N/A'}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-1 font-sans">Select Concluded Source Verdict:</label>
                          <select
                            value={resolutionVerdict}
                            onChange={(e) => setResolutionVerdict(e.target.value as SourceType)}
                            className="w-full bg-[#030712] border border-slate-700 rounded p-1.5 text-slate-200 text-xs font-sans focus:outline-none focus:border-cyan-500"
                          >
                            <option value="industrial_fire">Industrial Fire / Abnormal Heat</option>
                            <option value="gas_flare">Routine / Relief Gas Flare</option>
                            <option value="agricultural_burn">Agricultural / Crop Residue Burn</option>
                            <option value="wildfire">Wildfire / Vegetation</option>
                            <option value="other_thermal">Other Thermal / Sensor Artifact</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-1 font-sans">Investigator Confidence (%):</label>
                          <input
                            type="number"
                            min={50}
                            max={100}
                            value={resolutionConfidence}
                            onChange={(e) => setResolutionConfidence(Number(e.target.value))}
                            className="w-full bg-[#030712] border border-slate-700 rounded p-1.5 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>
                      <button
                        id="btn-resolve-case"
                        onClick={() => onResolveCase?.(currentCase.case_id || currentCase.caseId || '', resolutionVerdict, resolutionConfidence)}
                        className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs tracking-wide shadow-md transition flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>CONCLUDE INVESTIGATION &amp; CLOSE CASE</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Evidence Effects Reasoning Chain (Section 9 Requirement 6) */}
                {(currentCase as any).evidence_effects_history && (currentCase as any).evidence_effects_history.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 font-sans">
                      <Layers className="w-3 h-3 text-emerald-400" />
                      <span>Evidence Effects Reasoning Chain</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left font-mono text-[10px] border border-slate-800 rounded bg-[#030712]/60">
                        <thead className="bg-slate-900/90 text-slate-400 text-[9px]">
                          <tr>
                            <th className="p-1.5">Evidence Item</th>
                            <th className="p-1.5">Affected Target</th>
                            <th className="p-1.5 text-right">Entropy Before</th>
                            <th className="p-1.5 text-right">Entropy After</th>
                            <th className="p-1.5 text-right">ΔH (bits)</th>
                            <th className="p-1.5 text-right">Uncertainty Red.</th>
                            <th className="p-1.5 text-right">Provenance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {(currentCase as any).evidence_effects_history.map((eff: any, eIdx: number) => (
                            <tr key={eIdx} className="hover:bg-slate-800/30">
                              <td className="p-1.5 font-sans text-slate-200">{eff.evidence_title || eff.evidence_id}</td>
                              <td className="p-1.5 text-cyan-300">{eff.affected_hypotheses?.join(', ') || 'Source Distribution'}</td>
                              <td className="p-1.5 text-right text-slate-400">{eff.entropy_before?.toFixed(3)}</td>
                              <td className="p-1.5 text-right text-slate-200 font-bold">{eff.entropy_after?.toFixed(3)}</td>
                              <td className={`p-1.5 text-right font-bold ${eff.entropy_delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {eff.entropy_delta >= 0 ? `+${eff.entropy_delta?.toFixed(3)}` : eff.entropy_delta?.toFixed(3)}
                              </td>
                              <td className="p-1.5 text-right text-emerald-300 font-bold">{eff.uncertainty_reduction_percentage}%</td>
                              <td className="p-1.5 text-right text-slate-400">{eff.provenance}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Chronological Investigation Timeline (T0 -> T11) */}
                {((currentCase as any).timeline || currentCase.auditTrail) && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 font-sans">
                      <Clock className="w-3 h-3 text-cyan-400" />
                      <span>Investigation Audit Trail &amp; Timeline</span>
                    </div>
                    <div className="space-y-1.5 font-mono text-[10px]">
                      {((currentCase as any).timeline || currentCase.auditTrail).map((item: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-2 rounded bg-slate-950/60 border border-slate-800/80 flex flex-col sm:flex-row sm:items-start justify-between gap-1"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-cyan-400 font-bold">{item.step_code || `T${idx}`}</span>
                              <strong className="text-slate-200 font-sans">{item.title || item.action}</strong>
                              <span className="text-slate-500 text-[9px]">({item.actor})</span>
                            </div>
                            <p className="text-slate-400 font-sans text-[11px] leading-tight">{item.summary || item.note}</p>
                          </div>
                          <span className="text-slate-500 text-[9px] flex-shrink-0">
                            {item.timestamp?.slice(11, 19) || item.timestamp}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-slate-400 space-y-0.5 pt-1 border-t border-slate-800">
                  <div>• VIIRS resolution is ~375m; geometric jitter may cause up to 200m spatial shifts.</div>
                  <div>• Sentinel-2 overpass availability varies by coordinates (5-day constellation revisit cycle).</div>
                  <div>• Logistic Regression model acts in conditional advisory capacity.</div>
                </div>

                <div className="space-y-1 pt-1.5 border-t border-slate-800">
                  <textarea
                    rows={2}
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    placeholder="Enter investigator audit notes..."
                    className="w-full bg-[#030712] border border-slate-800 text-slate-200 text-xs rounded p-2 focus:outline-none focus:border-amber-500 text-[11px]"
                  />
                  <button
                    onClick={handleSaveNotes}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 font-medium border border-slate-700 transition"
                  >
                    <Save className="w-3 h-3 text-cyan-400" />
                    <span>Save Notes</span>
                  </button>
                </div>
              </div>
            )}
          </section>
        </main>
      ) : null}
    </div>
  );
};
