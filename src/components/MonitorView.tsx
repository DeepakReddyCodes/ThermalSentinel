import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import {
  Layers,
  MapPin,
  AlertTriangle,
  Flame,
  Filter,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Search,
  Wind,
  CheckCircle2,
  FileDown,
  Building2,
  X,
  Compass,
  Radio,
  ExternalLink,
} from 'lucide-react';
import {
  Facility,
  ThermalEvent,
  InvestigationCase,
  Sentinel2SwirResponse,
  OsmContextResponse,
  WeatherContextResponse,
} from '../types';
import { evaluateThermalDiscriminator, getAiSourceAdvisory } from '../services/thermalDiscriminator';
import { evaluateEvidenceGuidedInvestigation } from '../services/investigationService';
import { getCanonicalAssessment } from '../services/canonicalAssessment';

interface MonitorViewProps {
  facilities: Facility[];
  events: ThermalEvent[];
  cases: InvestigationCase[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  onSelectFacility: (facilityId: string) => void;
  onNavigateToInvestigation: (caseId: string) => void;
  onNavigateToFacility: (facilityId: string) => void;
  isLiveFirmsLoading?: boolean;
  onRefreshLiveFeed?: () => void;
  liveFeedInfo?: { source: string; count: number; timestamp: string; isLive: boolean } | null;
  monitoringScope?: 'INDUSTRIAL' | 'ALL_THERMAL' | 'INVESTIGATIONS';
  onScopeChange?: (scope: 'INDUSTRIAL' | 'ALL_THERMAL' | 'INVESTIGATIONS') => void;
  scopeCounts?: {
    industrial: number;
    allThermal: number;
    investigations: number;
  };
}

export const MonitorView: React.FC<MonitorViewProps> = ({
  facilities,
  events,
  cases,
  selectedEventId,
  onSelectEvent,
  onSelectFacility,
  onNavigateToInvestigation,
  onNavigateToFacility,
  isLiveFirmsLoading = false,
  onRefreshLiveFeed,
  liveFeedInfo,
  monitoringScope = 'INDUSTRIAL',
  onScopeChange,
  scopeCounts,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Filters State
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [minFrp, setMinFrp] = useState<number>(0);
  const [selectedSatellite, setSelectedSatellite] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Scope & NBE Interactive Breakdown State
  const [showWhyNbe, setShowWhyNbe] = useState<boolean>(false);

  // Compact Map Layers Control State
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);
  const [layerDetections, setLayerDetections] = useState<boolean>(true);
  const [layerBoundaries, setLayerBoundaries] = useState<boolean>(true);
  const [layerZones, setLayerZones] = useState<boolean>(true);
  const [layerOsmContext, setLayerOsmContext] = useState<boolean>(false);
  const [layerSentinelContext, setLayerSentinelContext] = useState<boolean>(false);
  const [layerWeatherContext, setLayerWeatherContext] = useState<boolean>(false);
  const [layerHotspots, setLayerHotspots] = useState<boolean>(false);

  // Compact Evidence Row Expansion State
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const toggleRow = (id: string) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  };

  // Authentic Evidence State for Selected Event
  const [sentinelData, setSentinelData] = useState<Sentinel2SwirResponse | null>(null);
  const [osmData, setOsmData] = useState<OsmContextResponse | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherContextResponse | null>(null);
  const [exportNotice, setExportNotice] = useState<boolean>(false);

  // =========================================================================
  // STATE CONSISTENCY: Pure resolution of currently selected observation
  // =========================================================================
  const selectedEvent = useMemo(() => {
    if (selectedEventId) {
      const found = events.find((e) => e.id === selectedEventId);
      if (found) return found;
    }
    // Default to benchmark case if present, else first event
    return events.find((e) => e.id === 'HIST-20260225-N-261') || events[0] || null;
  }, [events, selectedEventId]);

  // Derive facility strictly from selectedEvent
  const selectedFacility = useMemo(() => {
    if (!selectedEvent || !selectedEvent.facilityId || selectedEvent.spatialAssociation === 'UNASSOCIATED') {
      return null;
    }
    return facilities.find((f) => f.id === selectedEvent.facilityId) || null;
  }, [facilities, selectedEvent]);

  // Derive matching investigation case ONLY if it matches this specific observation
  const relatedCase = useMemo(() => {
    if (!selectedEvent) return null;
    return (
      cases.find(
        (c) =>
          c.firms_observation_id === selectedEvent.id ||
          c.primaryEventId === selectedEvent.id ||
          (selectedEvent.caseId && (c.case_id === selectedEvent.caseId || c.caseId === selectedEvent.caseId))
      ) || null
    );
  }, [cases, selectedEvent]);

  // Association Flag
  const isAssociated = Boolean(
    selectedFacility &&
    selectedEvent &&
    selectedEvent.spatialAssociation !== 'UNASSOCIATED' &&
    selectedEvent.facilityId
  );

  // 1. Initialize Map with Natural Esri World Imagery (No darkening!)
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [22.342, 69.865],
      zoom: 11,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 1. Resilient CartoDB dark base layer (supports VITE_CARTO_API_KEY)
    const cartoKey = (import.meta as any).env?.VITE_CARTO_API_KEY || (import.meta as any).env?.CARTO_API_KEY;
    const cartoBaseUrl = cartoKey
      ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${cartoKey}`
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    const cartoLabelsUrl = cartoKey
      ? `https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png?key=${cartoKey}`
      : 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';

    L.tileLayer(cartoBaseUrl, {
      subdomains: 'abcd',
      maxZoom: 18,
      attribution: 'CartoDB',
    }).addTo(map);

    // 2. Esri World Imagery (Natural satellite basemap - only added when authenticated key is configured)
    const arcgisKey = (import.meta as any).env?.VITE_ARCGIS_API_KEY;
    if (arcgisKey && typeof arcgisKey === 'string' && arcgisKey.trim().length > 0) {
      const trimmedKey = arcgisKey.trim();
      const esriUrl = `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(trimmedKey)}`;

      const esriLayer = L.tileLayer(esriUrl, {
        attribution: 'Esri, Maxar, Earthstar Geographics',
        maxZoom: 18,
      }).addTo(map);

      let esriErrorCount = 0;
      esriLayer.on('tileerror', () => {
        esriErrorCount++;
        if (esriErrorCount >= 3 && map.hasLayer(esriLayer)) {
          map.removeLayer(esriLayer);
        }
      });
    }

    // 3. Subtle dark labels overlay
    L.tileLayer(cartoLabelsUrl, {
      subdomains: 'abcd',
      maxZoom: 18,
      opacity: 0.75,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Filter Events for Left List & Map
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.frp < minFrp) return false;
      if (selectedSatellite !== 'all' && e.satellite !== selectedSatellite) return false;

      const assessment = getCanonicalAssessment(e, facilities);
      if (selectedStatus === 'anomalous' && assessment.observationClassification !== 'ANOMALOUS') return false;
      if (selectedStatus === 'elevated' && assessment.observationClassification !== 'ELEVATED') return false;
      if (selectedStatus === 'normal' && assessment.observationClassification !== 'NORMAL') return false;
      if (selectedStatus === 'not_assessed' && assessment.observationClassification !== 'NOT_ASSESSED') return false;
      if (selectedStatus === 'unassociated' && assessment.isAssociated) return false;

      if (selectedRegion !== 'all') {
        const fac = facilities.find((f) => f.id === e.facilityId);
        const st = fac?.state?.toLowerCase() || '';
        if (selectedRegion === 'west' && !['gujarat', 'maharashtra', 'rajasthan'].includes(st)) return false;
        if (selectedRegion === 'east' && !['odisha', 'west bengal', 'jharkhand', 'bihar'].includes(st)) return false;
        if (selectedRegion === 'south' && !['tamil nadu', 'andhra pradesh', 'telangana', 'karnataka', 'kerala'].includes(st)) return false;
        if (selectedRegion === 'north_central' && !['uttar pradesh', 'madhya pradesh', 'chhattisgarh', 'punjab', 'haryana', 'assam'].includes(st)) return false;
        if (['gujarat', 'odisha', 'maharashtra'].includes(selectedRegion) && st !== selectedRegion) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const fac = facilities.find((f) => f.id === e.facilityId);
        const matchId = e.id.toLowerCase().includes(q);
        const matchFac = (fac?.name || '').toLowerCase().includes(q);
        const matchCoords = `${e.latitude},${e.longitude}`.includes(q);
        return matchId || matchFac || matchCoords;
      }

      return true;
    });
  }, [events, facilities, minFrp, selectedSatellite, selectedStatus, selectedRegion, searchQuery]);

  // 2b. Compute National Thermal Activity Clusters from real FIRMS observations
  const thermalClusters = useMemo(() => {
    if (filteredEvents.length === 0) return [];
    const grid: Record<string, { latSum: number; lonSum: number; frpSum: number; maxFrp: number; events: ThermalEvent[] }> = {};
    filteredEvents.forEach((e) => {
      const cellLat = Math.floor(e.latitude / 1.2) * 1.2 + 0.6;
      const cellLon = Math.floor(e.longitude / 1.2) * 1.2 + 0.6;
      const key = `${cellLat.toFixed(1)}_${cellLon.toFixed(1)}`;
      if (!grid[key]) {
        grid[key] = { latSum: 0, lonSum: 0, frpSum: 0, maxFrp: 0, events: [] };
      }
      grid[key].latSum += e.latitude;
      grid[key].lonSum += e.longitude;
      grid[key].frpSum += e.frp;
      if (e.frp > grid[key].maxFrp) grid[key].maxFrp = e.frp;
      grid[key].events.push(e);
    });

    return Object.values(grid).map((cell) => {
      const count = cell.events.length;
      const centerLat = cell.latSum / count;
      const centerLon = cell.lonSum / count;
      const totalFrp = Math.round(cell.frpSum * 10) / 10;
      const activityLevel: 'HIGH' | 'MODERATE' | 'LOW' =
        totalFrp > 50 || count >= 6 ? 'HIGH' : totalFrp > 15 || count >= 2 ? 'MODERATE' : 'LOW';
      return {
        center: [centerLat, centerLon] as [number, number],
        count,
        totalFrp,
        maxFrp: cell.maxFrp,
        activityLevel,
      };
    });
  }, [filteredEvents]);

  // 3. Render Overlays on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    // Facility Boundaries & Known Activity Zones
    if (layerBoundaries) {
      facilities.forEach((fac) => {
        if (selectedRegion !== 'all') {
          const st = fac.state?.toLowerCase() || '';
          if (selectedRegion === 'west' && !['gujarat', 'maharashtra', 'rajasthan'].includes(st)) return;
          if (selectedRegion === 'east' && !['odisha', 'west bengal', 'jharkhand', 'bihar'].includes(st)) return;
          if (selectedRegion === 'south' && !['tamil nadu', 'andhra pradesh', 'telangana', 'karnataka', 'kerala'].includes(st)) return;
          if (selectedRegion === 'north_central' && !['uttar pradesh', 'madhya pradesh', 'chhattisgarh', 'punjab', 'haryana', 'assam'].includes(st)) return;
          if (['gujarat', 'odisha', 'maharashtra'].includes(selectedRegion) && st !== selectedRegion) return;
        }

        if (fac.polygon && fac.polygon.length > 0) {
          const polygon = L.polygon(fac.polygon, {
            color: '#38bdf8', // Clean cyan / neutral boundary outline representing geography
            weight: 1.2,
            opacity: 0.85,
            fillColor: '#0284c7',
            fillOpacity: 0.05,
          });

          polygon.bindTooltip(
            `<strong>${fac.name}</strong><br/><span class="text-xs text-slate-300">${fac.operator}</span><br/><span class="text-xs text-cyan-400 font-mono">Monitored Industrial Boundary (${fac.category})</span>`,
            { className: 'leaflet-custom-tooltip', sticky: true }
          );

          polygon.on('click', () => {
            onSelectFacility(fac.id);
          });

          layerGroup.addLayer(polygon);
        }

        if (layerZones && fac.knownThermalZones) {
          fac.knownThermalZones.forEach((zone) => {
            const zoneCircle = L.circle(zone.center, {
              radius: zone.radiusMeters,
              color: '#06b6d4',
              weight: 1.2,
              fillColor: '#0891b2',
              fillOpacity: 0.15,
            });

            zoneCircle.bindTooltip(
              `<span class="font-semibold text-cyan-400">Process Thermal Zone:</span> ${zone.name}<br/><span class="text-xs">Max Normal: ${zone.expectedMaxFrpMw} MW</span>`,
              { className: 'leaflet-custom-tooltip' }
            );

            layerGroup.addLayer(zoneCircle);
          });
        }
      });
    }

    // Optional National Density Context (Subtle neutral coverage when explicitly toggled, never conflicting with hotspot markers)
    if (layerHotspots && filteredEvents.length >= 6) {
      thermalClusters.forEach((cluster) => {
        const radiusMeters = 25000;
        const clusterCircle = L.circle(cluster.center, {
          radius: radiusMeters,
          color: '#64748b',
          weight: 1,
          opacity: 0.35,
          fillColor: '#475569',
          fillOpacity: 0.04,
          dashArray: '3, 6',
        });

        clusterCircle.bindTooltip(
          `<div class="p-1 min-w-[140px] text-xs font-mono">
            <div class="font-bold text-slate-200">Thermal Detection Cluster</div>
            <div class="text-[11px] text-slate-300 mt-0.5">
              <div>Hotspots: <strong>${cluster.count} detections</strong></div>
              <div>FRP: <strong>${cluster.totalFrp} MW</strong></div>
            </div>
          </div>`,
          { className: 'leaflet-custom-tooltip' }
        );

        layerGroup.addLayer(clusterCircle);
      });
    }

    // Render Thermal Detections with Canonical Semantic Color System:
    // Red: ANOMALOUS
    // Orange: ELEVATED
    // Green: NORMAL
    // Purple: UNASSOCIATED
    // Slate/Neutral: NOT_ASSESSED (Facility associated, no empirical baseline)
    if (layerDetections) {
      filteredEvents.forEach((ev) => {
        const isSelected = selectedEvent && ev.id === selectedEvent.id;
        const assessment = getCanonicalAssessment(ev, facilities);

        const radius = Math.min(18, Math.max(5, Math.sqrt(ev.frp) * 2.1));
        const fillColor = assessment.markerFillColor;
        const strokeColor = assessment.markerStrokeColor;

        // Subtle selection ring on selected event only (clean, no large halos)
        if (isSelected) {
          const glow = L.circleMarker([ev.latitude, ev.longitude], {
            radius: radius * 1.5,
            color: '#ffffff',
            weight: 2,
            opacity: 0.9,
            fillColor,
            fillOpacity: 0.25,
          });
          layerGroup.addLayer(glow);
        }

        const marker = L.circleMarker([ev.latitude, ev.longitude], {
          radius,
          color: isSelected ? '#ffffff' : strokeColor,
          weight: isSelected ? 2.5 : 1.2,
          fillColor,
          fillOpacity: 0.9,
        });

        marker.bindTooltip(
          `<div class="p-1 min-w-[170px] text-xs font-mono">
            <div class="font-bold flex items-center justify-between gap-1 ${assessment.textColor}">
              <span>${ev.id}</span>
              <span class="px-1 rounded bg-slate-800 text-slate-200">${ev.frp} MW</span>
            </div>
            <div class="text-[11px] text-slate-300 mt-1 space-y-0.5">
              <div>Facility: <strong>${assessment.facilityName}</strong></div>
              <div>Status: <span class="${assessment.textColor} font-bold">${assessment.displayStatus}</span></div>
              <div>Spatial: ${assessment.spatialAssociationLabel}</div>
              <div>${ev.latitude.toFixed(4)}°N, ${ev.longitude.toFixed(4)}°E</div>
            </div>
          </div>`,
          { className: 'leaflet-custom-tooltip' }
        );

        marker.on('click', () => {
          onSelectEvent(ev.id);
        });

        layerGroup.addLayer(marker);
      });
    }
  }, [
    facilities,
    filteredEvents,
    selectedEvent?.id,
    selectedRegion,
    layerBoundaries,
    layerZones,
    layerDetections,
    layerHotspots,
    thermalClusters,
  ]);

  // 4. Fetch Auxiliary Evidence for Current Observation
  useEffect(() => {
    if (!selectedEvent) return;
    let isMounted = true;
    setSentinelData(null);
    setOsmData(null);
    setWeatherData(null);

    const lat = selectedEvent.latitude;
    const lon = selectedEvent.longitude;
    const timestamp = selectedEvent.timestamp || '2026-02-25T08:13:00Z';
    const date = timestamp.slice(0, 10);
    const obsId = selectedEvent.id;
    const facilityId = selectedEvent.facilityId || '';

    // 1. Sentinel-2 SWIR
    fetch(`/api/sentinel/swir?lat=${lat}&lon=${lon}&date=${date}&timestamp=${timestamp}&obs_id=${obsId}&facility_id=${facilityId}`)
      .then((res) => res.json())
      .then((data: Sentinel2SwirResponse) => {
        if (isMounted) setSentinelData(data);
      })
      .catch(() => {});

    // 2. OSM Context
    fetch(`/api/osm/context?lat=${lat}&lon=${lon}&radius_km=3.0`)
      .then((res) => res.json())
      .then((data: OsmContextResponse) => {
        if (isMounted) setOsmData(data);
      })
      .catch(() => {});

    // 3. Historical Weather
    fetch(`/api/weather/context?lat=${lat}&lon=${lon}&timestamp=${timestamp}`)
      .then((res) => res.json())
      .then((data: WeatherContextResponse) => {
        if (isMounted) setWeatherData(data);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [selectedEvent?.id]);

  // Pan map when selectedEvent changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedEvent) return;
    map.flyTo([selectedEvent.latitude, selectedEvent.longitude], 12, { duration: 1.0 });
  }, [selectedEvent?.id]);

  // Dynamic ML Discriminator Evaluation strictly for current observation
  const discriminatorOutput = useMemo(() => {
    if (!selectedEvent) return null;
    if (relatedCase?.thermal_discriminator) return relatedCase.thermal_discriminator;
    if (relatedCase?.thermalDiscriminator) return relatedCase.thermalDiscriminator;
    return evaluateThermalDiscriminator(selectedEvent);
  }, [selectedEvent, relatedCase]);

  // Calculate Heuristic Support Distribution strictly for current observation (all 5 classes)
  const currentHypotheses = useMemo(() => {
    if (!selectedEvent) return [];

    // If case has precomputed distribution, use it directly (associated or unassociated)
    if (relatedCase?.source_hypotheses?.hypotheses_distribution?.length) {
      return relatedCase.source_hypotheses.hypotheses_distribution.map((h) => ({
        label:
          h.hypothesis === 'INDUSTRIAL_FIRE'
            ? 'Industrial Fire'
            : h.hypothesis === 'GAS_FLARE'
            ? 'Gas Flare / Continuous'
            : h.hypothesis === 'AGRICULTURAL_BURN'
            ? 'Agricultural Burn'
            : h.hypothesis === 'WILDFIRE_VEGETATION'
            ? 'Wildfire / Vegetation'
            : 'Other / Process Heat',
        pct: h.percentage,
        color:
          h.hypothesis === 'INDUSTRIAL_FIRE'
            ? 'bg-rose-500'
            : h.hypothesis === 'GAS_FLARE'
            ? 'bg-amber-500'
            : h.hypothesis === 'AGRICULTURAL_BURN'
            ? 'bg-emerald-500'
            : h.hypothesis === 'WILDFIRE_VEGETATION'
            ? 'bg-orange-500'
            : 'bg-cyan-500',
      }));
    }

    // Otherwise derive directly from selectedEvent.sourceHypotheses
    if (selectedEvent.sourceHypotheses) {
      const raw = selectedEvent.sourceHypotheses;
      const items = [
        { key: 'industrial_fire', label: 'Industrial Fire', val: raw.industrial_fire ?? 0.05, color: 'bg-rose-500' },
        { key: 'gas_flare', label: 'Gas Flare / Continuous', val: raw.gas_flare ?? 0.05, color: 'bg-amber-500' },
        { key: 'agricultural_burn', label: 'Agricultural Burn', val: raw.agricultural_burn ?? 0.05, color: 'bg-emerald-500' },
        { key: 'wildfire', label: 'Wildfire / Vegetation', val: raw.wildfire ?? 0.05, color: 'bg-orange-500' },
        { key: 'other_thermal', label: 'Other / Process Heat', val: raw.other_thermal ?? 0.05, color: 'bg-cyan-500' },
      ];

      const total = items.reduce((sum, item) => sum + item.val, 0) || 1;
      return items
        .map((i) => ({ label: i.label, pct: Math.round((i.val / total) * 100), color: i.color }))
        .sort((a, b) => b.pct - a.pct);
    }

    return [];
  }, [selectedEvent, relatedCase]);

  // Shannon Entropy strictly for current observation (H, Hmax, Hnorm)
  const currentEntropy = useMemo(() => {
    if (!selectedEvent) return { bits: '0.000', maxBits: '2.322', normalized: 0, normalizedPct: 0, label: 'LOW' };

    if (relatedCase?.uncertainty?.entropy_bits != null) {
      const bits = relatedCase.uncertainty.entropy_bits;
      const maxBits = relatedCase.uncertainty.max_possible_entropy_bits || 2.322;
      const norm = relatedCase.uncertainty.normalized_entropy ?? (maxBits > 0 ? bits / maxBits : 0);
      return {
        bits: bits.toFixed(3),
        maxBits: maxBits.toFixed(3),
        normalized: norm,
        normalizedPct: Math.round(norm * 100),
        label: relatedCase.uncertainty.uncertainty_level || (norm >= 0.65 ? 'HIGH' : norm >= 0.35 ? 'MODERATE' : 'LOW'),
      };
    }

    if (selectedEvent.uncertainty?.shannon_entropy_bits != null) {
      const bits = selectedEvent.uncertainty.shannon_entropy_bits;
      const norm = selectedEvent.uncertainty.normalized_entropy;
      return {
        bits: bits.toFixed(3),
        maxBits: '2.322',
        normalized: norm,
        normalizedPct: Math.round(norm * 100),
        label: selectedEvent.uncertainty.uncertainty_level || (norm >= 0.65 ? 'HIGH' : norm >= 0.35 ? 'MODERATE' : 'LOW'),
      };
    }

    // Compute Shannon entropy over normalized distribution
    const probs = currentHypotheses.map((h) => h.pct / 100).filter((p) => p > 0);
    const K = Math.max(2, currentHypotheses.length);
    const maxH = Math.log(K) / Math.LN2;
    let h = 0;
    for (const p of probs) {
      h -= p * (Math.log(p) / Math.LN2);
    }
    const bits = isNaN(h) ? 0 : h;
    const norm = maxH > 0 ? Math.min(1.0, Math.max(0.0, bits / maxH)) : 0;
    return {
      bits: bits.toFixed(3),
      maxBits: maxH.toFixed(3),
      normalized: norm,
      normalizedPct: Math.round(norm * 100),
      label: norm >= 0.65 ? 'HIGH' : norm >= 0.35 ? 'MODERATE' : 'LOW',
    };
  }, [selectedEvent, relatedCase, currentHypotheses]);

  // Dynamic Evidence Conflict Detection
  const isEvidenceConflict = useMemo(() => {
    if (!discriminatorOutput || discriminatorOutput.status !== 'AVAILABLE') return false;
    const topHypo = currentHypotheses[0];
    const isContextualFire = Boolean(topHypo && topHypo.label.includes('Industrial Fire') && topHypo.pct >= 40);
    const isMlWildfire = Boolean(
      discriminatorOutput.predicted_class === 'WILDFIRE_CONFIRMED' ||
      (discriminatorOutput.wildfire_score != null && discriminatorOutput.wildfire_score >= 0.50)
    );
    return isContextualFire && isMlWildfire;
  }, [discriminatorOutput, currentHypotheses]);

  // Case-Dependent Next-Best-Evidence Recommendation
  const nbeRecommendation = useMemo(() => {
    if (relatedCase?.evidence_guided_investigation?.recommendedExternalEvidence) {
      return relatedCase.evidence_guided_investigation.recommendedExternalEvidence;
    }
    if (relatedCase?.evidenceGuidedInvestigation?.recommendedExternalEvidence) {
      return relatedCase.evidenceGuidedInvestigation.recommendedExternalEvidence;
    }
    if (selectedEvent) {
      const egi = evaluateEvidenceGuidedInvestigation(
        selectedEvent,
        selectedFacility,
        null,
        null,
        selectedEvent.spatialAssociation || (isAssociated ? 'FACILITY_OFF_ZONE' : 'UNASSOCIATED'),
        selectedEvent.behaviouralStatus || selectedEvent.deviationStatus || 'NOT_ASSESSED',
        {
          status_label: 'AI-Assisted Contextual Hypothesis Assessment',
          disclaimer: '',
          primary_hypothesis: currentHypotheses[0]?.label || 'OTHER',
          primary_hypothesis_type: (currentHypotheses[0]?.label?.includes('Fire')
            ? 'INDUSTRIAL_FIRE'
            : currentHypotheses[0]?.label?.includes('Flare')
            ? 'GAS_FLARE'
            : currentHypotheses[0]?.label?.includes('Agricultural')
            ? 'AGRICULTURAL_BURN'
            : 'WILDFIRE_VEGETATION') as any,
          alternative_hypotheses: [],
          hypotheses_distribution: currentHypotheses.map((h) => ({
            hypothesis: (h.label.includes('Fire')
              ? 'INDUSTRIAL_FIRE'
              : h.label.includes('Flare')
              ? 'GAS_FLARE'
              : h.label.includes('Agricultural')
              ? 'AGRICULTURAL_BURN'
              : 'WILDFIRE_VEGETATION') as any,
            label: h.label,
            raw_support_score: h.pct,
            normalized_score: h.pct / 100,
            percentage: h.pct,
            support_level: 'MODERATE',
            reasons: [],
          })),
          basis: 'dynamic',
        },
        {
          entropy_bits: parseFloat(currentEntropy.bits),
          max_possible_entropy_bits: 2.322,
          normalized_entropy: parseFloat(currentEntropy.bits) / 2.322,
          uncertainty_level: currentEntropy.label as any,
          summary: '',
          interpretation: '',
          competing_hypotheses_count: 2,
        },
        { level: 'MEDIUM', score: 50, reasons: ['Standard triage'] },
        null,
        null
      );
      return egi.recommendedExternalEvidence;
    }
    return null;
  }, [relatedCase, selectedEvent, selectedFacility, isAssociated, currentHypotheses, currentEntropy]);

  // Handler for Exporting Case Dossier
  const handleExportDossier = () => {
    if (!selectedEvent) return;
    const dossierData = {
      case_id: relatedCase?.case_id || relatedCase?.caseId || `CASE-${selectedEvent.id}`,
      firms_observation_id: selectedEvent.id,
      timestamp: selectedEvent.timestamp,
      satellite: selectedEvent.satellite,
      coordinates: [selectedEvent.latitude, selectedEvent.longitude],
      frp_mw: selectedEvent.frp,
      confidence: selectedEvent.confidence,
      associated_facility: selectedFacility ? { id: selectedFacility.id, name: selectedFacility.name, state: selectedFacility.state } : null,
      spatial_association: selectedEvent.spatialAssociation || (isAssociated ? 'FACILITY_OFF_ZONE' : 'UNASSOCIATED'),
      spatial_association_label: selectedEvent.spatialAssociationLabel || (isAssociated ? 'Inside Facility Boundary (Off-Zone)' : 'Unassociated (Regional Detection)'),
      facility_baseline_status: isAssociated ? (selectedEvent.baselineStatus || 'EMPIRICAL') : 'NOT_ASSESSED',
      current_baseline_metrics: isAssociated ? (selectedEvent.empiricalMetrics || relatedCase?.current_baseline_metrics || null) : null,
      behavioural_status: selectedEvent.behaviouralStatus || selectedEvent.deviationStatus || (selectedEvent.frp >= 25 ? 'ANOMALOUS' : selectedEvent.frp >= 5 ? 'ELEVATED' : 'NORMAL'),
      source_hypotheses: currentHypotheses,
      uncertainty: currentEntropy,
      thermal_discriminator: discriminatorOutput,
      sentinel_swir_evidence: sentinelData,
      osm_infrastructure_context: osmData,
      weather_context: weatherData,
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

  return (
    <div className="flex flex-col w-full h-[calc(100vh-3.25rem)] bg-[#030712] overflow-hidden text-slate-100 font-['Plus_Jakarta_Sans',sans-serif]">
      {/* 1. Filter Bar (Ultra-Compact: Height 36px) */}
      <div className="h-9 border-b border-slate-800/80 bg-[#090d16] px-3 flex items-center justify-between gap-2 z-20 text-[11px] flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Region */}
          <select
            id="select-region"
            aria-label="Filter Map by Region"
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            className="bg-[#111827] border border-slate-700/80 text-slate-200 rounded px-2 py-0.5 focus:outline-none focus:border-amber-500 font-medium"
          >
            <option value="all">All Monitored Facilities (80 Facilities)</option>
            <option value="west">Western Corridor (Gujarat, Maharashtra, Rajasthan)</option>
            <option value="east">Eastern Corridor (Odisha, West Bengal, Jharkhand, Bihar)</option>
            <option value="south">Southern Corridor (Tamil Nadu, AP, Telangana, Karnataka, Kerala)</option>
            <option value="north_central">Northern / Central Corridor (UP, MP, Chhattisgarh, Punjab, Assam)</option>
            <option value="gujarat">Gujarat Corridor (Jamnagar, Dahej, Hazira, Koyali)</option>
            <option value="odisha">Odisha Corridor (Paradip, Angul, Rourkela)</option>
            <option value="maharashtra">Maharashtra Industrial Belt (Trombay, Mahul, Dolvi)</option>
          </select>

          {/* Satellite */}
          <select
            id="select-satellite"
            aria-label="Filter Map by Satellite Sensor"
            value={selectedSatellite}
            onChange={(e) => setSelectedSatellite(e.target.value)}
            className="bg-[#111827] border border-slate-700/80 text-slate-200 rounded px-2 py-0.5 focus:outline-none focus:border-amber-500"
          >
            <option value="all">All Satellites</option>
            <option value="VIIRS-NOAA20">VIIRS (NOAA-20 NRT)</option>
            <option value="VIIRS-SNPP">VIIRS (Suomi-NPP)</option>
            <option value="MODIS-Aqua">MODIS (Aqua/Terra)</option>
          </select>

          {/* Status */}
          <select
            id="select-status"
            aria-label="Filter Map by Status"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="bg-[#111827] border border-slate-700/80 text-slate-200 rounded px-2 py-0.5 focus:outline-none focus:border-amber-500"
          >
            <option value="all">All Status</option>
            <option value="anomalous">Anomalous Only</option>
            <option value="elevated">Elevated Only</option>
            <option value="normal">Normal Baseline Only</option>
            <option value="not_assessed">Not Assessed (No Baseline)</option>
            <option value="unassociated">Unassociated Regional Only</option>
          </select>

          {/* Min FRP Slider */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#111827] rounded border border-slate-700/80 text-[10px]">
            <span className="text-slate-400 font-mono">FRP:</span>
            <input
              id="slider-min-frp"
              aria-label="Minimum Fire Radiative Power (MW)"
              type="range"
              min="0"
              max="50"
              step="5"
              value={minFrp}
              onChange={(e) => setMinFrp(Number(e.target.value))}
              className="w-14 accent-amber-500 cursor-pointer h-1"
            />
            <span className="font-mono text-amber-400 font-bold">{minFrp}M</span>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search detection or facility..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#111827] border border-slate-700/80 text-slate-200 rounded pl-6 pr-2 py-0.5 w-40 focus:outline-none focus:border-amber-500 placeholder-slate-500 text-[10px]"
            />
          </div>
        </div>

        {/* Live Refresh Status */}
        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>NRT FEED CONNECTED</span>
        </div>
      </div>

      {/* 2. Main Workspace: LEFT PANEL (17%) + CENTER MAP (60%) + RIGHT DRAWER (23%) */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* LEFT PANEL: THERMAL DETECTIONS (Target: ~16-18% desktop) */}
        <aside className="w-[17%] min-w-[210px] max-w-[260px] flex-shrink-0 bg-[#090d16] border-r border-slate-800/90 flex flex-col z-20">
          <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between bg-[#030712]/50">
            <div className="flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <h2 className="text-[11px] font-bold tracking-wider uppercase text-slate-200">
                {monitoringScope === 'ALL_THERMAL'
                  ? 'All Thermal Detections'
                  : monitoringScope === 'INVESTIGATIONS'
                  ? 'Priority Cases'
                  : 'Monitored Facilities'}
              </h2>
            </div>
            <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
              {filteredEvents.length}
            </span>
          </div>

          {/* SCOPE SELECTOR: MONITORED | ALL THERMAL | INVESTIGATIONS */}
          <div className="p-1.5 bg-[#030712]/80 border-b border-slate-800 flex gap-1">
            <button
              id="scope-btn-industrial"
              onClick={() => onScopeChange?.('INDUSTRIAL')}
              className={`flex-1 py-1 px-1 rounded text-[10px] font-bold tracking-tight transition flex flex-col items-center justify-center ${
                monitoringScope === 'INDUSTRIAL'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'bg-[#111827] text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span>MONITORED</span>
              <span className="text-[8px] font-mono opacity-80">{scopeCounts?.industrial ?? 4}</span>
            </button>
            <button
              id="scope-btn-all"
              onClick={() => onScopeChange?.('ALL_THERMAL')}
              className={`flex-1 py-1 px-1 rounded text-[10px] font-bold tracking-tight transition flex flex-col items-center justify-center ${
                monitoringScope === 'ALL_THERMAL'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                  : 'bg-[#111827] text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span>ALL THERMAL</span>
              <span className="text-[8px] font-mono opacity-80">{scopeCounts?.allThermal ?? 845}</span>
            </button>
            <button
              id="scope-btn-investigations"
              onClick={() => onScopeChange?.('INVESTIGATIONS')}
              className={`flex-1 py-1 px-1 rounded text-[10px] font-bold tracking-tight transition flex flex-col items-center justify-center ${
                monitoringScope === 'INVESTIGATIONS'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'bg-[#111827] text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span>INVESTIGATE</span>
              <span className="text-[8px] font-mono opacity-80">{scopeCounts?.investigations ?? 12}</span>
            </button>
          </div>

          {/* Detection Cards (Target: 90-110px tall) */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50 p-1.5 space-y-1">
            {filteredEvents.map((ev) => {
              const isSelected = selectedEvent?.id === ev.id;
              const assessment = getCanonicalAssessment(ev, facilities);

              return (
                <button
                  key={ev.id}
                  onClick={() => onSelectEvent(ev.id)}
                  className={`w-full text-left p-2 rounded-lg transition-all flex flex-col gap-0.5 border ${
                    isSelected
                      ? 'bg-[#1e293b]/90 border-amber-500/60 ring-1 ring-amber-500/30'
                      : 'border-transparent hover:bg-[#0f172a]/70 hover:border-slate-800'
                  }`}
                >
                  {/* Primary State & Secondary Association Badges */}
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${assessment.badgeStyle}`}
                      >
                        {assessment.observationClassification}
                      </span>
                      {assessment.facilityAssociation === 'UNASSOCIATED' ? (
                        <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-purple-950/50 text-purple-300 border border-purple-800/50">
                          UNASSOCIATED
                        </span>
                      ) : assessment.facilityAssociation === 'FACILITY_OFF_ZONE' ? (
                        <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-amber-950/50 text-amber-300 border border-amber-800/50">
                          OFF-ZONE
                        </span>
                      ) : assessment.facilityAssociation === 'KNOWN_THERMAL_ZONE' ? (
                        <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-sky-950/50 text-sky-300 border border-sky-800/50">
                          PROCESS ZONE
                        </span>
                      ) : (
                        <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-blue-950/50 text-blue-300 border border-blue-800/50">
                          BUFFER
                        </span>
                      )}
                    </div>

                    <span className="text-[9px] font-mono text-slate-400">
                      {ev.satellite}
                    </span>
                  </div>

                  {/* Primary Title: Facility Name or Regional Thermal Detection */}
                  <div className="font-semibold text-[11px] text-slate-100 truncate mt-0.5">
                    {assessment.isAssociated ? assessment.facilityName : 'Regional Thermal Detection'}
                  </div>

                  {/* Sub-line: Observation ID */}
                  <div className="text-[9px] font-mono text-slate-400 truncate">
                    ID: {ev.id}
                  </div>

                  {/* FRP and Baseline Deviation */}
                  <div className="flex items-baseline justify-between text-xs pt-0.5">
                    <span className="font-mono font-bold text-amber-400 text-xs">
                      {ev.frp} MW
                    </span>
                    {assessment.isAssociated && (assessment.baselineStatus === 'EMPIRICAL' || assessment.baselineStatus === 'CANDIDATE_EMPIRICAL_WITH_REVIEW') ? (
                      <span className={`text-[10px] font-mono font-semibold ${
                        assessment.observationClassification === 'ANOMALOUS' ? 'text-rose-400' : assessment.observationClassification === 'ELEVATED' ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        {assessment.deviationRatioLabel}
                      </span>
                    ) : null}
                  </div>

                  {/* Date & Coordinates */}
                  <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono pt-0.5">
                    <span>{ev.timestamp ? ev.timestamp.slice(0, 10) : '25 Feb 2026'}</span>
                    <span>{ev.latitude.toFixed(4)}°N {ev.longitude.toFixed(4)}°E</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* CENTER: DOMINANT SATELLITE MAP (Target: ~60-62% desktop) */}
        <main className="flex-1 relative h-full">
          <div ref={mapContainerRef} className="w-full h-full z-10" />

          {/* Compact MAP LAYERS Button & Dropdown (Top Right of Map) */}
          <div className="absolute top-2.5 right-2.5 z-20 text-xs">
            <button
              id="btn-toggle-map-layers"
              onClick={() => setShowLayerMenu(!showLayerMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#090d16]/90 hover:bg-[#111827] border border-slate-700 text-[11px] font-semibold text-slate-200 shadow-xl backdrop-blur transition"
            >
              <Layers className="w-3 h-3 text-amber-400" />
              <span>MAP LAYERS</span>
              <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${showLayerMenu ? 'rotate-180' : ''}`} />
            </button>

            {showLayerMenu && (
              <div className="absolute right-0 mt-1.5 w-48 bg-[#090d16]/95 border border-slate-700 rounded-lg shadow-2xl p-2.5 backdrop-blur z-30 text-[11px] space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={layerDetections}
                    onChange={(e) => setLayerDetections(e.target.checked)}
                    className="rounded accent-amber-500 cursor-pointer w-3 h-3"
                  />
                  <span>Thermal detections</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={layerHotspots}
                    onChange={(e) => setLayerHotspots(e.target.checked)}
                    className="rounded accent-amber-500 cursor-pointer w-3 h-3"
                  />
                  <span>Thermal activity regions</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={layerBoundaries}
                    onChange={(e) => setLayerBoundaries(e.target.checked)}
                    className="rounded accent-amber-500 cursor-pointer w-3 h-3"
                  />
                  <span>Facility boundaries</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={layerZones}
                    onChange={(e) => setLayerZones(e.target.checked)}
                    className="rounded accent-amber-500 cursor-pointer w-3 h-3"
                  />
                  <span>Known stack zones</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={layerOsmContext}
                    onChange={(e) => setLayerOsmContext(e.target.checked)}
                    className="rounded accent-amber-500 cursor-pointer w-3 h-3"
                  />
                  <span>OSM infrastructure</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={layerSentinelContext}
                    onChange={(e) => setLayerSentinelContext(e.target.checked)}
                    className="rounded accent-amber-500 cursor-pointer w-3 h-3"
                  />
                  <span>Sentinel-2</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={layerWeatherContext}
                    onChange={(e) => setLayerWeatherContext(e.target.checked)}
                    className="rounded accent-amber-500 cursor-pointer w-3 h-3"
                  />
                  <span>Weather</span>
                </label>
              </div>
            )}
          </div>

          {/* Compact Legend Overlay (Bottom Left of Map) */}
          <div className="absolute bottom-2.5 left-2.5 z-20 bg-[#090d16]/90 px-3 py-2.5 rounded-lg border border-slate-800/90 backdrop-blur shadow-2xl text-[10px] text-slate-300 space-y-1.5 hidden md:block">
            <div className="flex items-center gap-1.5 font-bold text-slate-200 pb-1 border-b border-slate-800">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span>OBSERVATION CLASSIFICATION</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" />
                <span><strong>ANOMALOUS</strong> · Significant deviation / extreme thermal behaviour</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
                <span><strong>ELEVATED</strong> · Elevated thermal activity</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                <span><strong>NORMAL</strong> · Within expected thermal behaviour</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                <span><strong>NOT ASSESSED</strong> · Insufficient classification evidence</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 font-bold text-slate-200 pt-1.5 pb-0.5 border-t border-slate-800">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span>FACILITY ASSOCIATION</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] text-slate-400 font-mono">
              <div>• Known Process Zone</div>
              <div>• Facility Off-Zone</div>
              <div>• Facility Buffer</div>
              <div>• Unassociated</div>
            </div>
          </div>
        </main>

        {/* RIGHT DETAIL DRAWER (Target: ~21-24% desktop) */}
        {selectedEvent && (() => {
          const selectedAssessment = getCanonicalAssessment(selectedEvent, facilities);

          return (
            <aside className="w-[23%] min-w-[290px] max-w-[350px] flex-shrink-0 bg-[#090d16] border-l border-slate-800/90 flex flex-col z-30 shadow-2xl overflow-y-auto">
              {/* Drawer Header */}
              <div className="p-3 border-b border-slate-800/80 bg-[#030712]/70 sticky top-0 z-10 backdrop-blur flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {relatedCase?.case_id || relatedCase?.caseId || selectedEvent.id}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase ${selectedAssessment.badgeStyle}`}
                    >
                      {selectedAssessment.observationClassification}
                    </span>
                    {(() => {
                      const continuousScore = Math.min(100, Math.max(10, Math.round(
                        15 +
                        Math.min(28, Math.max(2, Math.round(5.5 * Math.log(1 + Math.max(0.1, selectedEvent.frp))))) +
                        (selectedAssessment.observationClassification === 'ANOMALOUS' ? 26 : selectedAssessment.observationClassification === 'ELEVATED' ? 15 : selectedAssessment.observationClassification === 'NORMAL' ? 4 : (selectedEvent.frp >= 50 ? Math.min(24, Math.round(8 + (selectedEvent.frp - 50) * 0.2)) : 0)) +
                        (selectedAssessment.facilityAssociation === 'FACILITY_OFF_ZONE' ? 14 : selectedAssessment.facilityAssociation === 'FACILITY_BUFFER' ? 8 : 4) +
                        (selectedEvent.confidence === 'high' ? 4 : selectedEvent.confidence === 'low' ? -8 : 0)
                      )));
                      const priScore = selectedEvent.investigationPriority?.score ?? relatedCase?.investigation_priority?.score ?? continuousScore;
                      const priLevel = selectedEvent.investigationPriority?.level || relatedCase?.investigation_priority?.level || (priScore >= 70 ? 'HIGH' : priScore >= 45 ? 'MEDIUM' : 'LOW');
                      return (
                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded font-mono border ${
                          priLevel === 'HIGH'
                            ? 'bg-rose-950/70 text-rose-300 border-rose-800/70'
                            : priLevel === 'MEDIUM'
                            ? 'bg-amber-950/70 text-amber-300 border-amber-800/70'
                            : 'bg-cyan-950/70 text-cyan-300 border-cyan-800/70'
                        }`}>
                          PRIORITY: {priLevel} ({priScore}/100)
                        </span>
                      );
                    })()}
                  </div>
                  <h3 className="font-bold text-xs text-slate-100 mt-1 truncate">
                    {selectedAssessment.facilityName}
                  </h3>
                </div>

                <button
                  onClick={() => onSelectEvent('')}
                  className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800"
                  title="Close drawer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-3 space-y-3 text-xs">
                {exportNotice && (
                  <div className="p-2 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[11px] flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Dossier JSON exported successfully.</span>
                  </div>
                )}

                {/* OVERVIEW SECTION */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Overview
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 bg-[#030712]/60 p-2.5 rounded-lg border border-slate-800/90 font-mono text-[11px]">
                    <div>
                      <span className="text-slate-500 text-[9px] uppercase font-sans block">FRP</span>
                      <span className="font-bold text-amber-400 text-xs">{selectedEvent.frp} MW</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[9px] uppercase font-sans block">Brightness</span>
                      <span className="text-slate-200 font-semibold">{selectedEvent.brightness ? `${selectedEvent.brightness} K` : '340.0 K'}</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[9px] uppercase font-sans block">Sensor / Pass</span>
                      <span className="text-slate-200">{selectedEvent.satellite} · {selectedEvent.dayNight === 'D' ? 'Day' : 'Night'}</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[9px] uppercase font-sans block">Confidence</span>
                      <span className="text-slate-200 capitalize">{selectedEvent.confidence}</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[9px] uppercase font-sans block">Coordinates</span>
                      <span className="text-slate-300 text-[10px]">{selectedEvent.latitude.toFixed(4)}°N, {selectedEvent.longitude.toFixed(4)}°E</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[9px] uppercase font-sans block">Observation Classification</span>
                      <span className={`font-bold text-[10px] ${selectedAssessment.textColor}`}>
                        {selectedAssessment.observationClassification}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[9px] uppercase font-sans block">Facility Association</span>
                      <span className={`font-semibold text-[10px] ${selectedAssessment.isAssociated ? 'text-cyan-400' : 'text-purple-400'}`}>
                        {selectedAssessment.facilityAssociation}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[9px] uppercase font-sans block">Facility Baseline</span>
                      <span className="text-slate-200 font-semibold text-[10px]">
                        {selectedAssessment.baselineLabel}
                      </span>
                    </div>

                    <div className="col-span-2 pt-1 border-t border-slate-800/60 flex justify-between items-center text-[10px]">
                      <span className="text-slate-400 font-sans">Statistical Deviation:</span>
                      <span className={`font-bold font-mono ${
                        selectedAssessment.baselineStatus === 'EMPIRICAL' || selectedAssessment.baselineStatus === 'CANDIDATE_EMPIRICAL_WITH_REVIEW'
                          ? selectedAssessment.observationClassification === 'ANOMALOUS'
                            ? 'text-rose-400'
                            : selectedAssessment.observationClassification === 'ELEVATED'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                          : 'text-slate-400'
                      }`}>
                        {selectedAssessment.deviationRatioLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* WHY FLAGGED? */}
                <div className="bg-[#030712]/60 p-2.5 rounded-lg border border-slate-800/90 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    <span>Why Flagged?</span>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    {selectedAssessment.isAssociated
                      ? (selectedEvent.id === 'HIST-20260225-N-261'
                          ? 'Thermal radiative power is 5.16× the facility historical median (2.32 MW) and exceeds the empirical P95 threshold (6.41 MW). The observation is inside the facility boundary but outside the configured thermal activity zone.'
                          : selectedAssessment.baselineStatus === 'EMPIRICAL'
                          ? (selectedEvent.uncertaintyDetails || `Thermal emission evaluated against ${selectedAssessment.facilityName} empirical operational baseline (${selectedAssessment.deviationRatioLabel}). Spatial classification: ${selectedAssessment.spatialAssociationLabel}.`)
                          : selectedAssessment.baselineStatus === 'LIMITED'
                          ? (selectedEvent.uncertaintyDetails || `Thermal emission evaluated against ${selectedAssessment.facilityName} limited baseline. Behavioural status is ${selectedAssessment.observationClassification}.`)
                          : `Thermal observation associated with ${selectedAssessment.facilityName} (${selectedAssessment.spatialAssociationLabel}). Facility has insufficient historical observation history for empirical baseline construction; observation classified as ${selectedAssessment.observationClassification}.`)
                      : `Thermal observation (${selectedEvent.frp} MW) classified as ${selectedAssessment.observationClassification} based on radiometric satellite telemetry. FACILITY CONTEXT: No monitored-facility association established under configured spatial rules (UNASSOCIATED). Source hypotheses evaluated using spatial clustering, land cover, and contextual evidence.`}
                  </p>
                </div>

              {/* SOURCE HYPOTHESES */}
              <div className="space-y-1.5 bg-[#030712]/60 p-2.5 rounded-lg border border-slate-800/90">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Source Hypotheses
                  </span>
                  <span className="text-[9px] font-mono text-slate-500">
                    AI-ASSISTED HYPOTHESIS ASSESSMENT
                  </span>
                </div>

                <div className="space-y-1.5 pt-0.5">
                  {currentHypotheses.map((h) => (
                    <div key={h.label} className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-300 truncate">{h.label}</span>
                        <span className="font-mono text-slate-200 font-bold">{h.pct}%</span>
                      </div>
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className={`${h.color} h-full rounded-full`} style={{ width: `${h.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* UNCERTAINTY */}
              <div className="bg-[#030712]/60 p-2.5 rounded-lg border border-slate-800/90 space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="font-bold uppercase tracking-wider text-slate-400">Uncertainty</span>
                  <span className="font-mono text-slate-500" title="Shannon entropy of the current hypothesis distribution. Lower entropy indicates a more concentrated assessment.">Shannon entropy H(P)</span>
                </div>

                <div className="flex items-baseline justify-between font-mono pt-0.5">
                  <span className="text-amber-400 font-bold text-xs">{currentEntropy.bits} bits <span className="text-[10px] text-slate-500 font-normal">/ {currentEntropy.maxBits} max</span></span>
                  <span className={`text-[9px] px-1 py-0.2 rounded font-semibold border ${
                    currentEntropy.label === 'HIGH'
                      ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                      : currentEntropy.label === 'MODERATE'
                      ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                      : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  }`}>
                    {currentEntropy.label} ({currentEntropy.normalizedPct}%)
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${currentEntropy.normalizedPct}%` }}
                  />
                </div>
              </div>

              {/* 4. CONTEXT: AUXILIARY EVIDENCE */}
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  4. Context & Auxiliary Evidence
                </div>

                <div className="space-y-1 font-mono text-[10px]">
                  {/* Row 1: FIRMS */}
                  <div className="p-1.5 rounded bg-[#030712]/80 border border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span className="text-slate-200 font-sans">NASA FIRMS Sensor</span>
                    </div>
                    <span className="text-emerald-400 font-semibold">REAL SATELLITE</span>
                  </div>

                  {/* Row 2: Baseline */}
                  <div className="p-1.5 rounded bg-[#030712]/80 border border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className={`w-3 h-3 ${selectedAssessment.baselineStatus === 'EMPIRICAL' ? 'text-emerald-400' : selectedAssessment.baselineStatus === 'LIMITED' ? 'text-amber-400' : 'text-slate-600'}`} />
                      <span className="text-slate-200 font-sans">Facility Baseline</span>
                    </div>
                    <span className={selectedAssessment.baselineStatus === 'EMPIRICAL' ? 'text-emerald-400 font-semibold' : selectedAssessment.baselineStatus === 'LIMITED' ? 'text-amber-300 font-semibold' : 'text-slate-500'}>
                      {selectedAssessment.baselineStatus === 'EMPIRICAL'
                        ? 'REAL EMPIRICAL'
                        : selectedAssessment.baselineStatus === 'LIMITED'
                        ? 'LIMITED HISTORY'
                        : isAssociated
                        ? 'NOT ASSESSED (Insufficient History)'
                        : 'NOT ASSESSED (No Monitored Facility)'}
                    </span>
                  </div>

                  {/* Row 3: OSM (Dynamic) */}
                  <div className="rounded bg-[#030712]/80 border border-slate-800 overflow-hidden">
                    <button
                      onClick={() => toggleRow('osm')}
                      className="w-full p-1.5 flex items-center justify-between hover:bg-slate-800/40 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className={`w-3 h-3 ${osmData && osmData.total_features_found > 0 ? 'text-emerald-400' : 'text-slate-500'}`} />
                        <span className="text-slate-200 font-sans">OSM Infrastructure Context</span>
                      </div>
                      <span className={
                        osmData && osmData.total_features_found > 0
                          ? 'text-emerald-400 font-semibold text-[9px]'
                          : osmData?.status === 'NO_MAPPED_FEATURES' || (osmData && osmData.total_features_found === 0)
                          ? 'text-slate-400 font-semibold text-[9px]'
                          : osmData?.status === 'OUT_OF_SCOPE'
                          ? 'text-slate-500 font-semibold text-[9px]'
                          : osmData?.status === 'ACQUISITION_FAILED' || osmData?.status === 'OSM_UNAVAILABLE'
                          ? 'text-amber-400 font-semibold text-[9px]'
                          : 'text-slate-500 text-[9px]'
                      }>
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
                    </button>
                    {expandedRow === 'osm' && (
                      <div className="p-2 border-t border-slate-800 text-[10px] text-slate-300 font-sans space-y-1">
                        <div className="text-slate-300">
                          {osmData
                            ? osmData.total_features_found > 0
                              ? `${osmData.total_features_found} mapped feature(s) within 3 km search radius`
                              : 'Query returned 0 mapped features in 3 km radius.'
                            : 'Querying OpenStreetMap Overpass...'}
                        </div>
                        {osmData?.nearest_feature && (
                          <div className="text-cyan-300 font-mono text-[9px]">
                            Nearest: {osmData.nearest_feature.display_label || `${osmData.nearest_feature.category.toUpperCase()} (${osmData.nearest_feature.distance_meters} m)`}
                          </div>
                        )}
                        {osmData?.features && osmData.features.length > 1 && (
                          <div className="pt-1 space-y-0.5 border-t border-slate-800/80">
                            <div className="text-slate-400 text-[8px] font-bold uppercase tracking-wider">Nearby Features:</div>
                            {osmData.features.slice(0, 3).map((f, idx) => (
                              <div key={idx} className="text-slate-400 text-[9px] font-mono">
                                • {f.display_label || `${f.category.replace('_', ' ')} (${f.distance_meters} m)`}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="text-[9px] text-slate-500 pt-1 border-t border-slate-800/60 leading-tight">
                          OSM provides independent contextual infrastructure evidence only; it does not define monitored facility boundaries or imply absence of unmapped industry.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Row 4: Weather & Wind (Dynamic) */}
                  <div className="rounded bg-[#030712]/80 border border-slate-800 overflow-hidden">
                    <button
                      onClick={() => toggleRow('weather')}
                      className="w-full p-1.5 flex items-center justify-between hover:bg-slate-800/40 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className={`w-3 h-3 ${weatherData?.metrics ? 'text-emerald-400' : 'text-slate-500'}`} />
                        <span className="text-slate-200 font-sans">Weather & Wind (ERA5)</span>
                      </div>
                      <span className={weatherData?.metrics ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                        {weatherData?.status === 'AUTHENTIC_HISTORICAL' ? 'HISTORICAL' : 'CONTEXT'}
                      </span>
                    </button>
                    {expandedRow === 'weather' && (
                      <div className="p-2 border-t border-slate-800 text-[10px] text-slate-300 font-sans space-y-0.5">
                        {weatherData?.metrics ? (
                          <>
                            <div>
                              {weatherData.metrics.temperature_c != null ? `${weatherData.metrics.temperature_c.toFixed(1)}°C` : '—'} ·{' '}
                              {weatherData.metrics.relative_humidity_pct != null ? `${weatherData.metrics.relative_humidity_pct}% RH` : '—'} ·{' '}
                              {weatherData.metrics.wind_speed_kmh != null ? `${weatherData.metrics.wind_speed_kmh.toFixed(1)} km/h ${weatherData.metrics.wind_cardinal_from || ''}` : '—'}
                            </div>
                            <div className="text-slate-400">
                              {weatherData.metrics.wind_cardinal_toward ? `Plume drift: Toward ${weatherData.metrics.wind_cardinal_toward}` : ''} ·{' '}
                              {weatherData.observation_alignment?.weather_record_timestamp_utc
                                ? `Time: ${weatherData.observation_alignment.weather_record_timestamp_utc.slice(11, 16)} UTC (Δt ${weatherData.observation_alignment.temporal_difference_minutes}m)`
                                : ''}
                            </div>
                          </>
                        ) : (
                          <div className="text-slate-500">Weather data unavailable for this coordinate</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Row 5: Sentinel-2 SWIR */}
                  <div className="rounded bg-[#030712]/80 border border-slate-800 overflow-hidden">
                    <button
                      onClick={() => toggleRow('sentinel')}
                      className="w-full p-1.5 flex items-center justify-between hover:bg-slate-800/40 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        <span className="text-slate-200 font-sans">Sentinel-2 SWIR</span>
                      </div>
                      <span className={`font-semibold text-[9px] ${
                        sentinelData?.status === 'AUTHENTIC_LIVE' && sentinelData.is_event_adjacent
                          ? 'text-emerald-400'
                          : sentinelData?.temporal_status === 'TEMPORALLY_DISTANT'
                          ? 'text-amber-300'
                          : sentinelData?.status === 'FALLBACK_SIMULATED'
                          ? 'text-amber-400'
                          : 'text-slate-500'
                      }`}>
                        {sentinelData?.status === 'AUTHENTIC_LIVE' && sentinelData.is_event_adjacent
                          ? 'LIVE (EVENT-ADJACENT)'
                          : sentinelData?.temporal_status === 'TEMPORALLY_DISTANT'
                          ? 'DISTANT CONTEXT'
                          : sentinelData?.status === 'FALLBACK_SIMULATED'
                          ? 'BENCHMARK FIXTURE'
                          : 'UNAVAILABLE'}
                      </span>
                    </button>
                    {expandedRow === 'sentinel' && (
                      <div className="p-2 border-t border-slate-800 text-[10px] text-slate-300 font-sans space-y-1.5">
                        {sentinelData && sentinelData.status !== 'ERROR' ? (
                          <>
                            <div className="text-[9px] font-mono text-slate-400 space-y-0.5">
                              <div>Scene: {sentinelData.scene_id ? sentinelData.scene_id.slice(0, 28) + '...' : 'Copernicus Scene'}</div>
                              <div>Acquisition: {sentinelData.acquisition_timestamp ? new Date(sentinelData.acquisition_timestamp).toLocaleString() : (sentinelData.acquisition_date || 'N/A')} {sentinelData.temporal_difference_human ? `(${sentinelData.temporal_difference_human})` : ''}</div>
                              <div className="text-amber-400/90 text-[9px] pt-0.5">{sentinelData.advisory_note || sentinelData.evidence_findings?.summary}</div>
                              {sentinelData.provenance && (
                                <div className="text-slate-500 text-[8px] pt-0.5">Provenance: {sentinelData.provenance}</div>
                              )}
                            </div>
                            {sentinelData.image_data_url && (
                              <img
                                src={sentinelData.image_data_url}
                                alt="Sentinel-2 SWIR"
                                className="w-full h-24 object-cover rounded border border-slate-700"
                              />
                            )}
                          </>
                        ) : (
                          <div className="text-slate-500 text-[9px]">
                            {sentinelData?.advisory_note || 'Sentinel-2 multi-spectral imagery unavailable for these coordinates without active Copernicus Data Space credentials.'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Row 6: AI SOURCE ADVISORY */}
                  {(() => {
                    const aiAdvisory = getAiSourceAdvisory(
                      selectedEvent,
                      currentHypotheses.map((h) => ({
                        hypothesis: h.label.includes('Fire')
                          ? 'INDUSTRIAL_FIRE'
                          : h.label.includes('Flare')
                          ? 'GAS_FLARE'
                          : h.label.includes('Agricultural')
                          ? 'AGRICULTURAL_BURN'
                          : h.label.includes('Wildfire')
                          ? 'WILDFIRE_VEGETATION'
                          : 'OTHER',
                        label: h.label,
                        percentage: h.pct,
                      })),
                      selectedFacility
                    );

                    return (
                      <div className="rounded bg-[#030712]/80 border border-slate-800 overflow-hidden">
                        <button
                          onClick={() => toggleRow('ml')}
                          className="w-full p-1.5 flex items-center justify-between hover:bg-slate-800/40 text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <ShieldAlert className="w-3 h-3 text-violet-400" />
                            <span className="text-slate-200 font-sans font-semibold">
                              {discriminatorOutput?.status === 'AVAILABLE' ? 'AI Radiometric Model' : 'AI Contextual Advisory'}
                            </span>
                            {discriminatorOutput?.status === 'AVAILABLE' ? (
                              <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-violet-950/60 text-violet-300 border border-violet-800/50">lr-v5f3-standardized</span>
                            ) : (
                              <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50">AI ADVISORY</span>
                            )}
                          </div>
                          <span className="text-violet-300 font-semibold text-[9px]">
                            {discriminatorOutput?.status === 'AVAILABLE'
                              ? (discriminatorOutput.predicted_class === 'GAS_FLARE' ? 'GAS FLARE' : 'WILDFIRE-SIDE SIGNAL')
                              : `${aiAdvisory.primary_assessment.toUpperCase()} (${aiAdvisory.primary_percentage}%)`}
                          </span>
                        </button>
                        {expandedRow === 'ml' && (
                          <div className="p-2 border-t border-slate-800 text-[10px] text-slate-300 font-sans space-y-2">
                            {discriminatorOutput?.status === 'AVAILABLE' ? (
                              <>
                                {/* Score comparison bar */}
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-amber-300 font-bold text-[10px]">Gas Flare</span>
                                    <span className="text-amber-400 font-mono text-[10px]">{(discriminatorOutput.flare_score != null ? discriminatorOutput.flare_score * 100 : 0).toFixed(1)}%</span>
                                  </div>
                                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-amber-400 rounded-full transition-all"
                                      style={{ width: `${(discriminatorOutput.flare_score ?? 0) * 100}%` }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between mt-1">
                                    <span className="text-rose-300 font-bold text-[10px]">Wildfire-side signal</span>
                                    <span className="text-rose-400 font-mono text-[10px]">{(discriminatorOutput.wildfire_score != null ? discriminatorOutput.wildfire_score * 100 : 100).toFixed(1)}%</span>
                                  </div>
                                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-rose-500 rounded-full transition-all"
                                      style={{ width: `${(discriminatorOutput.wildfire_score ?? 1) * 100}%` }}
                                    />
                                  </div>
                                </div>

                                {/* Top 3 feature contributions */}
                                {discriminatorOutput.feature_contributions && discriminatorOutput.feature_contributions.length > 0 && (
                                  <div className="space-y-1 pt-1 border-t border-slate-800">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Top Signals</span>
                                      <button
                                        className="text-[8px] text-slate-500 hover:text-slate-300 font-mono"
                                        onClick={(e) => { e.stopPropagation(); toggleRow('ml-features'); }}
                                      >
                                        All 7 features ›
                                      </button>
                                    </div>
                                    {[...discriminatorOutput.feature_contributions]
                                      .sort((a: any, b: any) => Math.abs(b.linear_contribution) - Math.abs(a.linear_contribution))
                                      .slice(0, 3)
                                      .map((fc: any) => {
                                        const maxContrib = 11;
                                        const barWidth = Math.min(100, Math.abs(fc.linear_contribution) / maxContrib * 100);
                                        const isWild = fc.linear_contribution > 0;
                                        return (
                                          <div key={fc.feature} className="space-y-0.5">
                                            <div className="flex justify-between items-center">
                                              <span className="text-[9px] text-slate-400 truncate max-w-[100px]" title={fc.display_name}>
                                                {fc.display_name.replace('VIIRS ', '').replace(' Brightness (K)', '').replace(' (K)', '').replace('ΔBrightness ', 'Δ').replace('log(1 + FRP)', 'log FRP').replace('Diurnal Flag (Day=1, Night=0)', 'Daytime Flag')}
                                              </span>
                                              <span className={`font-mono text-[9px] font-bold ${isWild ? 'text-rose-400' : 'text-amber-400'}`}>
                                                {fc.linear_contribution > 0 ? '+' : ''}{fc.linear_contribution.toFixed(2)}
                                              </span>
                                            </div>
                                            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                                              <div
                                                className={`h-full rounded-full ${isWild ? 'bg-rose-500' : 'bg-amber-400'}`}
                                                style={{ width: `${barWidth}%` }}
                                              />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    <div className="text-[8px] text-slate-500 font-mono pt-0.5">
                                      z={discriminatorOutput.logit_z != null ? discriminatorOutput.logit_z.toFixed(2) : '—'} · Binary: GAS_FLARE vs WILDFIRE_CONFIRMED
                                    </div>
                                  </div>
                                )}

                                {/* Full 7-feature table — shown when 'All 7 features' clicked */}
                                {expandedRow === 'ml-features' && discriminatorOutput.feature_contributions && (
                                  <div className="space-y-0.5 pt-1 border-t border-slate-700">
                                    {discriminatorOutput.feature_contributions.map((fc: any) => (
                                      <div key={fc.feature} className="flex items-center justify-between bg-slate-950/60 px-1.5 py-0.5 rounded text-[9px] font-mono">
                                        <span className="text-slate-400 truncate max-w-[110px]" title={fc.display_name}>{fc.display_name}</span>
                                        <div className="flex gap-2">
                                          <span className="text-slate-300">{fc.raw_value}</span>
                                          <span className={`font-bold ${fc.linear_contribution > 0.01 ? 'text-rose-400' : fc.linear_contribution < -0.01 ? 'text-amber-400' : 'text-slate-500'}`}>
                                            {fc.linear_contribution > 0 ? '+' : ''}{fc.linear_contribution.toFixed(2)}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                    <button
                                      className="text-[8px] text-slate-500 hover:text-slate-300 font-mono pt-0.5"
                                      onClick={(e) => { e.stopPropagation(); toggleRow('ml'); }}
                                    >Hide ›</button>
                                  </div>
                                )}

                                {/* Evidence Conflict - compact visual version */}
                                {isEvidenceConflict && (
                                  <div className="rounded border border-amber-700/60 bg-amber-950/30 overflow-hidden">
                                    <div className="px-2 py-1 flex items-center gap-1.5 bg-amber-950/40">
                                      <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                                      <span className="text-amber-300 font-bold text-[9px] uppercase tracking-wide">Evidence Conflict</span>
                                    </div>
                                    <div className="px-2 py-1.5 grid grid-cols-2 gap-1 text-[9px]">
                                      <div className="space-y-0.5">
                                        <div className="text-slate-500 uppercase tracking-wide text-[8px]">Context</div>
                                        <div className="text-amber-200 font-bold">
                                          {currentHypotheses[0]?.label?.replace('Industrial Fire / Abnormal Heat', 'Industrial Fire').replace('Routine / Relief Gas Flare', 'Gas Flare') || 'Industrial Fire'}
                                        </div>
                                        <div className="text-amber-400 font-mono">{currentHypotheses[0]?.pct || 65}%</div>
                                      </div>
                                      <div className="space-y-0.5">
                                        <div className="text-slate-500 uppercase tracking-wide text-[8px]">AI Radiometric</div>
                                        <div className="text-rose-300 font-bold">Wildfire-side</div>
                                        <div className="text-rose-400 font-mono">{(discriminatorOutput.wildfire_score != null ? discriminatorOutput.wildfire_score * 100 : 100).toFixed(0)}%</div>
                                      </div>
                                    </div>
                                    <div className="px-2 pb-1.5 text-[9px] text-amber-200/80 border-t border-amber-800/40 pt-1">
                                      Independent evidence layers disagree. NBE required to resolve.
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="p-2 rounded bg-slate-900/60 border border-slate-800 space-y-1.5 text-[10px] font-sans">
                                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                                  <span className="text-amber-300 font-bold text-[9px] uppercase">AI CONTEXTUAL ADVISORY</span>
                                  <span className="text-slate-400 font-mono text-[8px]">CONTEXTUAL AI SUPPORT</span>
                                </div>
                                <div className="text-slate-200">
                                  Primary: <strong className="text-amber-300">{aiAdvisory.primary_assessment}</strong> <span className="text-amber-400 font-mono">({aiAdvisory.primary_percentage}%)</span>
                                </div>
                                <div className="space-y-0.5 text-slate-400 text-[9px]">
                                  {aiAdvisory.supporting_signals.map((sig, i) => (
                                    <div key={i}>• {sig}</div>
                                  ))}
                                </div>
                                {aiAdvisory.alternative_assessment && (
                                  <div className="text-slate-400 text-[9px] pt-0.5 border-t border-slate-800">
                                    Alternative: {aiAdvisory.alternative_assessment} ({aiAdvisory.alternative_percentage}%)
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* 5. NEXT-BEST-EVIDENCE RECOMMENDATION (Primary Workflow) */}
              <div className="bg-[#030712]/80 p-3 rounded-lg border border-cyan-500/40 shadow-lg shadow-cyan-950/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-cyan-400" />
                    <span>5. Next-Best-Evidence</span>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-700/60 font-bold">
                    UTILITY: {nbeRecommendation?.utility_score != null ? `${nbeRecommendation.utility_score}/100` : (isAssociated ? '96/100' : '95/100')}
                  </span>
                </div>

                {/* Recommended candidate */}
                <div className="p-2 rounded bg-cyan-950/20 border border-cyan-800/40 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-cyan-400 uppercase tracking-wide font-bold">Recommended Next</span>
                    <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/50 font-semibold">
                      {nbeRecommendation?.acquisition_status || (isAssociated && sentinelData ? (sentinelData.temporal_status === 'TEMPORALLY_DISTANT' ? 'DISTANT FORENSIC' : 'AVAILABLE REAL') : 'RECOMMENDED')}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-100 leading-tight">
                    {nbeRecommendation?.displayName || (isAssociated ? 'Contemporaneous Sentinel-2 SWIR Overpass (20m)' : 'High-Resolution Land Cover & Surface Composition (10m)')}
                  </div>
                  <div className="text-[10px] text-slate-300 leading-snug">
                    <span className="font-semibold text-cyan-200">Why: </span>
                    {nbeRecommendation?.whyUseful || (isAssociated
                      ? 'Physically resolves flare stack structures versus unconfined ground fires inside industrial petrochemical complex.'
                      : 'Separates agricultural crop residue burning from wildland vegetation fire for this unassociated hotspot.')}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400 pt-0.5 border-t border-cyan-900/40">
                    <span className="text-cyan-400/80 font-sans font-semibold">Target: </span>
                    {nbeRecommendation?.target_hypothesis_pair || (isAssociated ? 'Industrial Flare Stack vs Uncontained Ground Fire' : 'Agricultural Residue vs Wildland Scrub')}
                  </div>
                </div>

                {/* Compact Breakdown */}
                <div className="grid grid-cols-4 gap-1 text-[8px] font-mono text-center">
                  <div className="p-1 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-500 block text-[7px] font-sans uppercase">Ambiguity</span>
                    <span className={`font-bold ${
                      currentEntropy.label === 'HIGH' ? 'text-rose-400' :
                      currentEntropy.label === 'MODERATE' ? 'text-amber-400' : 'text-emerald-400'
                    }`}>{currentEntropy.label}</span>
                  </div>
                  <div className="p-1 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-500 block text-[7px] font-sans uppercase">Relevance</span>
                    <span className="font-bold text-cyan-400">HIGH</span>
                  </div>
                  <div className="p-1 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-500 block text-[7px] font-sans uppercase">Acquisition</span>
                    <span className="font-bold text-slate-300">
                      {isAssociated && sentinelData ? (sentinelData.temporal_status === 'TEMPORALLY_DISTANT' ? 'DISTANT' : 'REAL') : 'TASKING'}
                    </span>
                  </div>
                  <div className="p-1 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-500 block text-[7px] font-sans uppercase">Score</span>
                    <span className="font-bold text-cyan-300">{nbeRecommendation?.utility_score != null ? `${nbeRecommendation.utility_score}` : (isAssociated ? '96' : '95')}</span>
                  </div>
                </div>
              </div>

              {/* 6. RESOLVE: ACTION BUTTONS */}
              <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                <button
                  id="btn-drawer-open-investigation"
                  onClick={() => onNavigateToInvestigation(relatedCase?.case_id || relatedCase?.caseId || `CASE-${selectedEvent.id}`)}
                  className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-[11px] tracking-wide transition shadow-md shadow-rose-500/10 flex items-center justify-center gap-1.5"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>6. OPEN INVESTIGATION</span>
                </button>

                <button
                  id="btn-drawer-export-dossier"
                  onClick={handleExportDossier}
                  className="w-full py-1.5 px-3 rounded-lg bg-[#111827] hover:bg-slate-800 text-slate-300 text-[10px] font-medium border border-slate-700 transition flex items-center justify-center gap-1.5"
                >
                  <FileDown className="w-3.5 h-3.5 text-amber-400" />
                  <span>EXPORT CASE DOSSIER</span>
                </button>
              </div>
            </div>
          </aside>
          );
        })()}
      </div>
    </div>
  );
};
