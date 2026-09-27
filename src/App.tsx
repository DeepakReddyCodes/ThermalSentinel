import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { MonitorView } from './components/MonitorView';
import { FacilityIntelligence } from './components/FacilityIntelligence';
import { InvestigationEngine } from './components/InvestigationEngine';
import { ResearchValidationModal } from './components/ResearchValidationModal';

import { INITIAL_FACILITIES, getFacilityCalibratedBaseline } from './data/facilities';
import { INITIAL_THERMAL_EVENTS, INITIAL_INVESTIGATION_CASES } from './data/mockEvents';
import { EVIDENCE_CATALOG, getEvidenceForCase } from './data/evidenceLibrary';
import { Facility, ThermalEvent, InvestigationCase, SourceType } from './types';
import {
  fuseEvidenceIntoHypotheses,
  calculateInvestigationPriorityScore,
} from './services/evidenceEngine';
import {
  fetchBackendHealth,
  fetchBackendFirmsObservations,
  BackendHealthResponse,
} from './services/firmsService';
import {
  fetchInvestigationQueue,
  buildInvestigationCaseFromEvent,
  incorporateEvidenceAPI,
  resolveCaseAPI,
  resetCaseAPI,
} from './services/investigationService';

export default function App() {
  // 3 Primary Product Views: MONITOR, INVESTIGATIONS, FACILITIES
  const [currentTab, setCurrentTab] = useState<'monitor' | 'investigation' | 'facilities'>('monitor');

  // Monitor View Scope: INDUSTRIAL (default), ALL_THERMAL, INVESTIGATIONS
  const [monitoringScope, setMonitoringScope] = useState<'INDUSTRIAL' | 'ALL_THERMAL' | 'INVESTIGATIONS'>('INDUSTRIAL');

  const [facilities, setFacilities] = useState<Facility[]>(INITIAL_FACILITIES);
  const [industrialEvents, setIndustrialEvents] = useState<ThermalEvent[]>(
    INITIAL_THERMAL_EVENTS.filter((e) => e.facilityId && e.spatialAssociation !== 'UNASSOCIATED')
  );
  const [allThermalEvents, setAllThermalEvents] = useState<ThermalEvent[]>(INITIAL_THERMAL_EVENTS);
  const [cases, setCases] = useState<InvestigationCase[]>(INITIAL_INVESTIGATION_CASES);

  const [selectedFacilityId, setSelectedFacilityId] = useState<string>(
    INITIAL_FACILITIES[0]?.id || ''
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    INITIAL_THERMAL_EVENTS[0]?.id || null
  );
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    INITIAL_INVESTIGATION_CASES[0]?.caseId || ''
  );

  // Secondary Research & Validation Modal State
  const [isResearchModalOpen, setIsResearchModalOpen] = useState<boolean>(false);

  // Live Backend & FIRMS ingestion state
  const [isLiveLoading, setIsLiveLoading] = useState<boolean>(true);
  const [backendHealth, setBackendHealth] = useState<BackendHealthResponse | null>(null);
  const [liveFeedMeta, setLiveFeedMeta] = useState<{
    source: string;
    count: number;
    timestamp: string;
  } | null>(null);
  const [baselineObsCount, setBaselineObsCount] = useState<number>(294);

  const loadLiveFirmsData = useCallback(async () => {
    setIsLiveLoading(true);
    try {
      const [health, result, realCases] = await Promise.all([
        fetchBackendHealth(),
        fetchBackendFirmsObservations({
          source: 'VIIRS_NOAA20_NRT',
          country: 'IND',
          dayRange: 1,
        }),
        fetchInvestigationQueue(),
      ]);

      if (health) setBackendHealth(health);

      fetch('/api/baselines/FAC-GUJ-JAMNAGAR-01')
        .then((r) => r.json())
        .then((b) => {
          if (b?.metrics?.observation_count) setBaselineObsCount(b.metrics.observation_count);
        })
        .catch(() => {});

      if (realCases && realCases.length > 0) {
        // Enrich realCases with initialHypotheses, currentHypotheses, recommendedEvidence, appliedEvidenceIds, auditTrail
        const enrichedCases: InvestigationCase[] = realCases.map((rc) => {
          const isAssociated = Boolean(
            rc.spatial_association !== 'UNASSOCIATED' &&
            (rc.associated_facility?.id || rc.facilityId)
          );
          const initialHypo: Record<SourceType, number> = rc.initialHypotheses || {
            gas_flare: isAssociated ? 0.44 : 0.02,
            industrial_fire: isAssociated ? (rc.behavioural_status === 'ANOMALOUS' ? 0.42 : 0.08) : 0.02,
            agricultural_burn: isAssociated ? 0.05 : 0.55,
            wildfire: isAssociated ? 0.04 : 0.35,
            mining_smelter: 0.02,
            other_thermal: isAssociated ? 0.03 : 0.06,
          };
          if (rc.source_hypotheses?.hypotheses_distribution) {
            for (const h of rc.source_hypotheses.hypotheses_distribution) {
              const k = h.hypothesis === 'INDUSTRIAL_FIRE' ? 'industrial_fire'
                : h.hypothesis === 'GAS_FLARE' ? 'gas_flare'
                : h.hypothesis === 'AGRICULTURAL_BURN' ? 'agricultural_burn'
                : h.hypothesis === 'WILDFIRE_VEGETATION' ? 'wildfire'
                : 'other_thermal';
              initialHypo[k as SourceType] = h.normalized_score;
            }
          }
          const recEvidence = rc.recommendedEvidence && rc.recommendedEvidence.length > 0
            ? rc.recommendedEvidence
            : getEvidenceForCase(rc.case_id || rc.caseId, rc.firms_observation_id || rc.primaryEventId, isAssociated);

          const defaultAuditTrail = rc.auditTrail && rc.auditTrail.length > 0
            ? rc.auditTrail
            : [
                {
                  timestamp: rc.timestamp || '2026-02-25T08:13:00Z',
                  actor: `${rc.satellite || 'VIIRS'} Ingestion Daemon`,
                  action: `Ingested hotspot ${rc.firms_observation_id || rc.primaryEventId || rc.case_id}`,
                  note: `FRP=${rc.frp || 0} MW, Coordinates: [${rc.coordinates ? rc.coordinates.join(', ') : '—'}]`,
                },
                {
                  timestamp: new Date(new Date(rc.timestamp || '2026-02-25T08:13:00Z').getTime() + 30000).toISOString(),
                  actor: 'Geospatial Context Engine',
                  action: `Spatial Association: ${rc.spatial_association_label || rc.spatial_association || 'Evaluated'}`,
                  note: isAssociated
                    ? `Matched facility: ${rc.associated_facility?.name || 'Refinery'}. Distance to zone: ${rc.deviation_metrics?.distance_to_nearest_configured_zone_meters ?? 0}m`
                    : 'Unassociated regional thermal detection outside monitored industrial perimeters.',
                },
                {
                  timestamp: new Date(new Date(rc.timestamp || '2026-02-25T08:13:00Z').getTime() + 45000).toISOString(),
                  actor: 'Facility Behavioural Profiler',
                  action: `Assessed Behaviour: ${rc.behavioural_status || 'ASSESSED'}`,
                  note: rc.explanation_reasons?.[0] || 'Operational baseline comparison performed.',
                },
                {
                  timestamp: new Date(new Date(rc.timestamp || '2026-02-25T08:13:00Z').getTime() + 60000).toISOString(),
                  actor: 'Evidence-Guided Investigation Engine',
                  action: `Created Case ${rc.case_id || rc.caseId}`,
                  note: `Priority Score: ${rc.investigation_priority?.score ?? rc.priorityScore ?? 50}/100 (${rc.investigation_priority?.level || rc.priorityLevel || 'MEDIUM'}). Next-Best-Evidence generated.`,
                },
              ];

          return {
            ...rc,
            initialHypotheses: initialHypo,
            currentHypotheses: rc.currentHypotheses || { ...initialHypo },
            appliedEvidenceIds: rc.appliedEvidenceIds || [],
            recommendedEvidence: recEvidence,
            auditTrail: defaultAuditTrail,
            deviationSummary: rc.deviationSummary || {
              intensityDeltaPct: rc.deviation_metrics?.frp_ratio_to_median ? Math.round((rc.deviation_metrics.frp_ratio_to_median - 1) * 100) : 100,
              frequencyDeltaPct: 150,
              durationDeltaPct: 80,
              newZoneDetected: rc.spatial_association === 'FACILITY_OFF_ZONE',
              footprintExceededMeters: rc.deviation_metrics?.distance_to_nearest_configured_zone_meters ?? 0,
              historicalMatchScore: 20,
            },
          };
        });

        setCases(enrichedCases);
        // Find benchmark case HIST-20260225-N-261
        const target =
          enrichedCases.find((c) => (c.firms_observation_id || c.primaryEventId) === 'HIST-20260225-N-261') ||
          enrichedCases[0];
        if (target) {
          setSelectedCaseId(target.case_id || target.caseId || '');
        }
      }

      if (result.status === 'SUCCESS' && result.events.length > 0) {
        // 1. Preserve the full real live feed (845 observations across South Asia)
        setAllThermalEvents(result.events);

        // 2. Filter live detections associated with currently monitored facilities
        const liveAssociated = result.events.filter(
          (e) => e.spatialAssociation && e.spatialAssociation !== 'UNASSOCIATED' && e.facilityId
        );

        // 3. Merge with curated industrial baseline events without overwriting them
        setIndustrialEvents((prev) => {
          const merged = [...prev];
          for (const la of liveAssociated) {
            if (!merged.some((m) => m.id === la.id)) {
              merged.push(la);
            }
          }
          return merged;
        });

        setLiveFeedMeta({
          source: result.source,
          count: result.count,
          timestamp: result.timestamp,
          isLive: result.isLiveExternal,
        });
      }
    } catch (err) {
      console.warn('Could not load live FIRMS observations on startup, using initial baseline:', err);
    } finally {
      setIsLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLiveFirmsData();
  }, [loadLiveFirmsData]);

  // Derive active events based on user-selected monitoring scope
  const activeEvents = React.useMemo(() => {
    if (monitoringScope === 'ALL_THERMAL') {
      return allThermalEvents;
    }
    if (monitoringScope === 'INVESTIGATIONS') {
      // Map cases into events for the map view
      const mapped = cases.map((c) => {
        const existing = industrialEvents.find(
          (e) => e.id === (c.firms_observation_id || c.primaryEventId)
        );
        const isUnassoc = (c.spatial_association === 'UNASSOCIATED') || !(c.associated_facility?.id || c.facilityId);
        return {
          id: c.firms_observation_id || c.primaryEventId || c.case_id,
          latitude: c.coordinates ? c.coordinates[0] : 22.34177,
          longitude: c.coordinates ? c.coordinates[1] : 69.86535,
          acquisitionTime: c.timestamp || '2026-02-25T08:13:00Z',
          satellite: c.satellite || 'VIIRS-N20',
          frp: c.frp || 0,
          brightness: 350.0,
          confidence: c.confidence || 'nominal',
          dayNight: 'D' as const,
          facilityId: isUnassoc ? null : (c.associated_facility?.id || c.facilityId),
          facilityDistanceMeters: c.deviation_metrics?.distance_to_facility_meters ?? 0,
          landCoverType: isUnassoc ? 'agricultural' : 'industrial',
          spatialAssociation: isUnassoc ? 'UNASSOCIATED' : (c.spatial_association || 'FACILITY_OFF_ZONE'),
          behaviouralStatus: c.behavioural_status || c.behaviour_assessment?.status || (c.frp >= 25 ? 'ANOMALOUS' : c.frp >= 5 ? 'ELEVATED' : 'NORMAL'),
          deviationStatus: c.behavioural_status || c.behaviour_assessment?.status || (c.frp >= 25 ? 'ANOMALOUS' : c.frp >= 5 ? 'ELEVATED' : 'NORMAL'),
          baselineStatus: isUnassoc ? 'NOT_ASSESSED' : (c.associated_facility?.id === 'FAC-GUJ-JAMNAGAR-01' ? 'EMPIRICAL' : 'CONTROLLED'),
          provenance: isUnassoc ? 'REAL_FIRMS' : (c.associated_facility?.id === 'FAC-GUJ-JAMNAGAR-01' ? 'REAL' : 'CONTROLLED'),
          spatialAssociationLabel: c.spatial_association_label || (isUnassoc ? 'Unassociated (Regional Detection)' : 'Monitored Facility'),
          sourceHypotheses: c.source_hypotheses?.hypotheses_distribution?.reduce((acc: any, h: any) => {
            acc[h.hypothesis.toLowerCase()] = h.normalized_score;
            return acc;
          }, {}) || {},
          caseId: c.case_id || c.caseId,
          notes: c.explanation_reasons?.[0] || 'Investigation Queue Case',
        };
      });
      return mapped.length > 0 ? mapped : industrialEvents;
    }
    // Default: INDUSTRIAL
    return industrialEvents;
  }, [monitoringScope, industrialEvents, allThermalEvents, cases]);

  // Apply Evidence to Case & Recalculate Entropy / Hypotheses (Section 9 Closed Loop)
  const handleApplyEvidenceToCase = async (caseId: string, evidenceId: string) => {
    try {
      const serverCase = await incorporateEvidenceAPI(caseId, {
        evidence_id: evidenceId,
        candidate_id: evidenceId,
      });
      if (serverCase) {
        setCases((prevCases) =>
          prevCases.map((c) =>
            (c.caseId === caseId || c.case_id === caseId) ? { ...c, ...serverCase } : c
          )
        );
        return;
      }
    } catch (e) {
      console.warn('Backend closed-loop evidence incorporation fallback:', e);
    }

    // Client-side state fallback
    setCases((prevCases) =>
      prevCases.map((c) => {
        const matches = (c.caseId === caseId) || (c.case_id === caseId);
        if (!matches) return c;

        const currentAppliedIds = c.appliedEvidenceIds || [];
        const updatedAppliedIds = currentAppliedIds.includes(evidenceId)
          ? currentAppliedIds
          : [...currentAppliedIds, evidenceId];

        const recList = c.recommendedEvidence && c.recommendedEvidence.length > 0
          ? c.recommendedEvidence
          : getEvidenceForCase(c.case_id || c.caseId, c.firms_observation_id || c.primaryEventId, !!c.facilityId);

        const updatedEvidenceList = recList.map((e) =>
          updatedAppliedIds.includes(e.id) ? { ...e, status: 'APPLIED' as const } : e
        );

        const initialHypo = c.initialHypotheses || {
          gas_flare: 0.44,
          industrial_fire: 0.42,
          agricultural_burn: 0.05,
          wildfire: 0.04,
          mining_smelter: 0.03,
          other_thermal: 0.02,
        };

        const fusionResult = fuseEvidenceIntoHypotheses(
          initialHypo,
          updatedEvidenceList
        );

        const appliedEvidenceItem = recList.find((e) => e.id === evidenceId);

        const newAuditItem = {
          timestamp: new Date().toISOString(),
          actor: 'Investigator / Evidence Engine',
          action: `Fused Evidence: ${appliedEvidenceItem?.title || evidenceId}`,
          note: `Entropy reduced from ${fusionResult.entropyBefore} to ${fusionResult.entropyAfter} bits (${fusionResult.uncertaintyReductionPercent}% uncertainty reduction). Leading hypothesis: ${fusionResult.topHypothesis.source.toUpperCase().replace('_', ' ')} (${fusionResult.topHypothesis.probability}%).`,
        };

        const targetFacility = facilities.find((f) => f.id === (c.facilityId || c.associated_facility?.id));
        const prio = calculateInvestigationPriorityScore({
          intensityDeltaPct: c.deviationSummary?.intensityDeltaPct ?? 100,
          newZoneDetected: c.deviationSummary?.newZoneDetected ?? true,
          isAmbiguous: fusionResult.entropyAfter > 0.8,
          facilityCategory: targetFacility?.category || 'refinery',
          frp: c.frp || 11.97,
          appliedEvidenceCount: updatedAppliedIds.length,
          currentIndustrialFireProb: fusionResult.updatedHypotheses.industrial_fire || 0,
        });

        return {
          ...c,
          status: 'UNDER_INVESTIGATION',
          appliedEvidenceIds: updatedAppliedIds,
          recommendedEvidence: updatedEvidenceList,
          currentHypotheses: fusionResult.updatedHypotheses,
          priorityScore: prio.score,
          priorityLevel: prio.level,
          investigation_priority: {
            score: prio.score,
            level: prio.level,
            reasons: [
              `Recalculated post-evidence fusion (${updatedAppliedIds.length} evidence layers incorporated).`,
              `Entropy shifted from ${fusionResult.entropyBefore} to ${fusionResult.entropyAfter} bits.`,
              `Leading source probability: ${fusionResult.topHypothesis.probability}%.`,
            ],
          },
          uncertaintyReductionMetric: {
            entropyBefore: fusionResult.entropyBefore,
            entropyAfter: fusionResult.entropyAfter,
            uncertaintyReductionPercent: fusionResult.uncertaintyReductionPercent,
            confidenceGainPercent: Math.round(
              ((fusionResult.updatedHypotheses.industrial_fire || 0) - (initialHypo.industrial_fire || 0)) * 100
            ),
          },
          uncertainty: {
            entropy_bits: fusionResult.entropyAfter,
            max_possible_entropy_bits: 2.585,
            normalized_entropy: parseFloat((fusionResult.entropyAfter / 2.585).toFixed(3)),
            uncertainty_level: fusionResult.entropyAfter < 0.7 ? 'LOW' : fusionResult.entropyAfter < 1.2 ? 'MODERATE' : 'HIGH',
            summary: `Updated after fusing ${updatedAppliedIds.length} evidence sources. Entropy: ${fusionResult.entropyAfter} bits.`,
            interpretation: fusionResult.entropyAfter < 0.7 ? 'Low ambiguity: Source candidate strongly favored.' : 'Moderate ambiguity: Further evidence recommended.',
            competing_hypotheses_count: fusionResult.entropyAfter < 0.7 ? 1 : 2,
          },
          auditTrail: [...(c.auditTrail || []), newAuditItem],
        };
      })
    );
  };

  const handleUpdateCaseNotes = (caseId: string, notes: string) => {
    setCases((prev) =>
      prev.map((c) =>
        c.caseId === caseId || c.case_id === caseId
          ? { ...c, investigatorNotes: notes, investigator_notes: notes }
          : c
      )
    );
  };

  const handleResolveCase = async (caseId: string, verdict: SourceType, confidence: number) => {
    try {
      const serverVerdict =
        verdict === 'gas_flare'
          ? 'GAS_FLARE'
          : verdict === 'industrial_fire'
          ? 'INDUSTRIAL_FIRE'
          : verdict === 'agricultural_burn'
          ? 'AGRICULTURAL_BURN'
          : verdict === 'wildfire'
          ? 'WILDFIRE_VEGETATION'
          : 'OTHER';

      const serverCase = await resolveCaseAPI(caseId, {
        verdict: serverVerdict,
        confidence,
        notes: 'Formally resolved by investigator.',
      });

      if (serverCase) {
        setCases((prev) =>
          prev.map((c) => (c.caseId === caseId || c.case_id === caseId ? { ...c, ...serverCase } : c))
        );
        return;
      }
    } catch (e) {
      console.warn('Backend closed-loop resolve fallback:', e);
    }

    // Client-side state fallback
    setCases((prev) =>
      prev.map((c) => {
        const matches = (c.caseId === caseId) || (c.case_id === caseId);
        if (!matches) return c;
        return {
          ...c,
          status: 'CLOSED_RESOLVED',
          resolution: {
            finalVerdict: verdict,
            confidence,
            resolvedAt: new Date().toISOString(),
            actionRecommended:
              verdict === 'industrial_fire'
                ? 'High-priority alert dispatched to Industrial Safety Directorate & Refinery Incident Control Room.'
                : 'Routine flare log confirmed with process operations supervisor.',
          },
          auditTrail: [
            ...(c.auditTrail || []),
            {
              timestamp: new Date().toISOString(),
              actor: 'Operator (Demonstration Closure)',
              action: `Case Resolved as: ${verdict.toUpperCase().replace('_', ' ')} (${confidence}% confidence)`,
              note: 'Investigation dossier closed with formal evidence audit trail.',
            },
          ],
        };
      })
    );
  };

  const handleResetCase = async (caseId: string) => {
    try {
      const serverCase = await resetCaseAPI(caseId);
      if (serverCase) {
        setCases((prev) =>
          prev.map((c) => (c.caseId === caseId || c.case_id === caseId ? { ...c, ...serverCase } : c))
        );
        return;
      }
    } catch (e) {
      console.warn('Backend closed-loop reset fallback:', e);
    }

    // Client fallback
    setCases((prev) =>
      prev.map((c) => {
        if (c.caseId !== caseId && c.case_id !== caseId) return c;
        const initial = c.initialHypotheses || c.currentHypotheses;
        return {
          ...c,
          status: 'ACTIVE_UNRESOLVED',
          appliedEvidenceIds: [],
          currentHypotheses: { ...initial },
          auditTrail: [
            ...(c.auditTrail || []),
            {
              timestamp: new Date().toISOString(),
              actor: 'Investigator',
              action: 'Case Reset to Pristine T0 Baseline',
              note: 'Cleared all provisional evidence items.',
            },
          ],
        };
      })
    );
  };

  const handleAddEvent = (newEvent: ThermalEvent) => {
    setAllThermalEvents((prev) => [newEvent, ...prev]);
    if (newEvent.spatialAssociation !== 'UNASSOCIATED' || newEvent.facilityId) {
      setIndustrialEvents((prev) => [newEvent, ...prev]);
    }

    if (newEvent.facilityId && newEvent.isAmbiguous) {
      const fac = facilities.find((f) => f.id === newEvent.facilityId);
      const newCaseId = `CASE-2026-${Math.floor(10000 + Math.random() * 90000)}`;

      const newCase: InvestigationCase = {
        caseId: newCaseId,
        facilityId: newEvent.facilityId,
        facilityName: fac?.name || 'Industrial Facility',
        primaryEventId: newEvent.id,
        status: 'ACTIVE_UNRESOLVED',
        priorityScore: newEvent.deviationStatus === 'HIGH_DEVIATION' ? 92 : 65,
        priorityLevel: newEvent.deviationStatus === 'HIGH_DEVIATION' ? 'HIGH' : 'MEDIUM',
        creationTimestamp: new Date().toISOString(),
        initialHypotheses: newEvent.sourceHypotheses,
        currentHypotheses: newEvent.sourceHypotheses,
        deviationSummary: {
          intensityDeltaPct: 120,
          frequencyDeltaPct: 150,
          durationDeltaPct: 75,
          newZoneDetected: !newEvent.isInsideKnownZone,
          footprintExceededMeters: newEvent.facilityDistanceMeters,
          historicalMatchScore: 25,
        },
        uncertaintyStatement: newEvent.uncertaintyDetails,
        recommendedEvidence: EVIDENCE_CATALOG['FIRMS-20260901-4821'] || [],
        appliedEvidenceIds: [],
        auditTrail: [
          {
            timestamp: new Date().toISOString(),
            actor: 'FIRMS Ingestion Engine',
            action: `Ingested Event ${newEvent.id}`,
            note: `FRP: ${newEvent.frp} MW at ${fac?.name}`,
          },
          {
            timestamp: new Date().toISOString(),
            actor: 'Evidence-Guided Investigation Engine',
            action: `Created Investigation Case ${newCaseId}`,
            note: 'Ambiguous source state detected. Recommended Next-Best-Evidence generated.',
          },
        ],
        investigatorNotes: 'Automated case generated from synthetic/live FIRMS ingestion.',
        uncertaintyReductionMetric: {
          entropyBefore: 1.3,
          entropyAfter: 1.3,
          uncertaintyReductionPercent: 0,
          confidenceGainPercent: 0,
        },
      };

      setCases((prev) => [newCase, ...prev]);
      setSelectedCaseId(newCaseId);
    }
  };

  const handleBulkAddEvents = (newEvents: ThermalEvent[]) => {
    setIndustrialEvents((prev) => [...newEvents, ...prev]);
  };

  const handleNavigateToInvestigation = useCallback((caseId: string) => {
    // 1. Check if case already exists in cases
    const existing = cases.find(
      (c) =>
        c.case_id === caseId ||
        c.caseId === caseId ||
        c.firms_observation_id === caseId ||
        c.primaryEventId === caseId
    );
    if (existing) {
      setSelectedCaseId(existing.case_id || existing.caseId || caseId);
      setCurrentTab('investigation');
      return;
    }

    // 2. Look up matching event from activeEvents or allThermalEvents
    const targetObsId = caseId.replace(/^CASE-/, '');
    const matchedEv =
      activeEvents.find((e) => e.id === caseId || e.id === targetObsId || `CASE-${e.id}` === caseId) ||
      allThermalEvents.find((e) => e.id === caseId || e.id === targetObsId || `CASE-${e.id}` === caseId);

    if (matchedEv) {
      const allFacs = facilities && facilities.length > 0 ? facilities : INITIAL_FACILITIES;
      const fac = matchedEv.facilityId ? allFacs.find((f) => f.id === matchedEv.facilityId) || INITIAL_FACILITIES.find((f) => f.id === matchedEv.facilityId) || null : null;
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
      const dynamicCase = buildInvestigationCaseFromEvent(matchedEv, fac, bLine);

      setCases((prev) => [dynamicCase, ...prev]);
      setSelectedCaseId(dynamicCase.case_id || dynamicCase.caseId || caseId);
      setCurrentTab('investigation');
      return;
    }

    // Fallback: set id directly
    setSelectedCaseId(caseId);
    setCurrentTab('investigation');
  }, [cases, activeEvents, allThermalEvents, facilities]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Header & Navigation Strip */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        activeCases={cases}
        events={activeEvents}
        onOpenResearchValidation={() => setIsResearchModalOpen(true)}
        liveFeedInfo={liveFeedMeta}
        baselineObservationCount={baselineObsCount}
      />

      {/* Main Product View */}
      <main className="flex-1 overflow-hidden">
        {/* VIEW 1: MONITOR (Primary Home Screen) */}
        {currentTab === 'monitor' && (
          <MonitorView
            facilities={facilities}
            events={activeEvents}
            cases={cases}
            selectedEventId={selectedEventId}
            onSelectEvent={setSelectedEventId}
            onSelectFacility={(facId) => {
              setSelectedFacilityId(facId);
              setCurrentTab('facilities');
            }}
            onNavigateToInvestigation={handleNavigateToInvestigation}
            onNavigateToFacility={(facId) => {
              setSelectedFacilityId(facId);
              setCurrentTab('facilities');
            }}
            isLiveFirmsLoading={isLiveLoading}
            onRefreshLiveFeed={loadLiveFirmsData}
            liveFeedInfo={liveFeedMeta}
            monitoringScope={monitoringScope}
            onScopeChange={setMonitoringScope}
            scopeCounts={{
              industrial: industrialEvents.length,
              allThermal: allThermalEvents.length,
              investigations: cases.length,
            }}
          />
        )}

        {/* VIEW 2: INVESTIGATIONS */}
        {currentTab === 'investigation' && (
          <InvestigationEngine
            cases={cases}
            selectedCaseId={selectedCaseId}
            onSelectCase={setSelectedCaseId}
            onApplyEvidenceToCase={handleApplyEvidenceToCase}
            onUpdateCaseNotes={handleUpdateCaseNotes}
            onResolveCase={handleResolveCase}
            onResetCase={handleResetCase}
            events={activeEvents}
            facilities={facilities}
          />
        )}

        {/* VIEW 3: FACILITIES */}
        {currentTab === 'facilities' && (
          <FacilityIntelligence
            facilities={facilities}
            selectedFacilityId={selectedFacilityId}
            onSelectFacility={setSelectedFacilityId}
            events={activeEvents}
            cases={cases}
            onNavigateToInvestigation={handleNavigateToInvestigation}
          />
        )}
      </main>

      {/* Secondary Research & Validation Modal */}
      <ResearchValidationModal
        isOpen={isResearchModalOpen}
        onClose={() => setIsResearchModalOpen(false)}
        facilities={facilities}
        onAddEvent={handleAddEvent}
        onBulkAddEvents={handleBulkAddEvents}
        onNavigateToInvestigation={handleNavigateToInvestigation}
      />
    </div>
  );
}
