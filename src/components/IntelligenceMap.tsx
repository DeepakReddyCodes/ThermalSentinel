import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Layers,
  MapPin,
  AlertTriangle,
  Flame,
  Filter,
  Eye,
  ArrowRight,
  ShieldAlert,
  Sliders,
  ChevronRight,
  Info,
  Maximize2,
  RefreshCw,
  Radio,
} from 'lucide-react';
import { Facility, ThermalEvent, InvestigationCase } from '../types';
import { formatSourceLabel } from '../services/evidenceEngine';
import { getCanonicalAssessment } from '../services/canonicalAssessment';

interface IntelligenceMapProps {
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
}

export const IntelligenceMap: React.FC<IntelligenceMapProps> = ({
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
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Filters State
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [minFrp, setMinFrp] = useState<number>(0);
  const [selectedSatellite, setSelectedSatellite] = useState<string>('all');
  const [showAmbiguousOnly, setShowAmbiguousOnly] = useState<boolean>(false);
  const [tileMode, setTileMode] = useState<'dark' | 'satellite'>('satellite');
  const [showPolygons, setShowPolygons] = useState<boolean>(true);
  const [showZones, setShowZones] = useState<boolean>(true);
  const [showBuffers, setShowBuffers] = useState<boolean>(false);

  // Selected Item for Drawer
  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;
  const selectedFacility = selectedEvent?.facilityId
    ? facilities.find((f) => f.id === selectedEvent.facilityId)
    : null;
  const relatedCase = selectedEvent?.caseId
    ? cases.find((c) => c.caseId === selectedEvent.caseId)
    : cases.find((c) => c.primaryEventId === selectedEvent?.id);

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [21.8, 73.0],
      zoom: 6,
      zoomControl: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Update Tiles
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove existing tile layers
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        map.removeLayer(layer);
      }
    });

    const arcgisKey = (import.meta as any).env?.VITE_ARCGIS_API_KEY;
    const cartoKey = (import.meta as any).env?.VITE_CARTO_API_KEY || (import.meta as any).env?.CARTO_API_KEY;
    const cartoBaseUrl = cartoKey
      ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${cartoKey}`
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    const cartoLabelsUrl = cartoKey
      ? `https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png?key=${cartoKey}`
      : 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';

    if (tileMode === 'satellite') {
      // 1. Resilient CartoDB dark base layer
      L.tileLayer(cartoBaseUrl, {
        subdomains: 'abcd',
        maxZoom: 18,
        attribution: 'CartoDB',
      }).addTo(map);

      // 2. Esri World Imagery (Natural satellite basemap - only added when authenticated key is configured)
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

      // 3. Subtle dark label overlay
      L.tileLayer(cartoLabelsUrl, {
        subdomains: 'abcd',
        maxZoom: 18,
        opacity: 0.7,
      }).addTo(map);
    } else {
      L.tileLayer(cartoBaseUrl, {
        attribution: 'CartoDB Dark Matter',
        subdomains: 'abcd',
        maxZoom: 18,
      }).addTo(map);
    }
  }, [tileMode]);

  // 3. Filter and Render Overlays
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    // Filter Events
    const filteredEvents = events.filter((e) => {
      if (e.frp < minFrp) return false;
      if (selectedSatellite !== 'all' && e.satellite !== selectedSatellite) return false;
      if (showAmbiguousOnly && !e.isAmbiguous) return false;
      if (selectedRegion !== 'all') {
        const fac = facilities.find((f) => f.id === e.facilityId);
        const st = fac?.state?.toLowerCase() || '';
        if (selectedRegion === 'west' && !['gujarat', 'maharashtra', 'rajasthan'].includes(st)) return false;
        if (selectedRegion === 'east' && !['odisha', 'west bengal', 'jharkhand', 'bihar'].includes(st)) return false;
        if (selectedRegion === 'south' && !['tamil nadu', 'andhra pradesh', 'telangana', 'karnataka', 'kerala'].includes(st)) return false;
        if (selectedRegion === 'north_central' && !['uttar pradesh', 'madhya pradesh', 'chhattisgarh', 'punjab', 'haryana', 'assam'].includes(st)) return false;
        if (['gujarat', 'odisha', 'maharashtra'].includes(selectedRegion) && st !== selectedRegion) return false;
      }
      return true;
    });

    // Render Facilities
    facilities.forEach((fac) => {
      if (selectedRegion !== 'all') {
        const st = fac.state?.toLowerCase() || '';
        if (selectedRegion === 'west' && !['gujarat', 'maharashtra', 'rajasthan'].includes(st)) return;
        if (selectedRegion === 'east' && !['odisha', 'west bengal', 'jharkhand', 'bihar'].includes(st)) return;
        if (selectedRegion === 'south' && !['tamil nadu', 'andhra pradesh', 'telangana', 'karnataka', 'kerala'].includes(st)) return;
        if (selectedRegion === 'north_central' && !['uttar pradesh', 'madhya pradesh', 'chhattisgarh', 'punjab', 'haryana', 'assam'].includes(st)) return;
        if (['gujarat', 'odisha', 'maharashtra'].includes(selectedRegion) && st !== selectedRegion) return;
      }

      // Facility Polygon: Clean cyan / neutral boundary outline representing geography
      if (showPolygons && fac.polygon && fac.polygon.length > 0) {
        const polygon = L.polygon(fac.polygon, {
          color: '#38bdf8',
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

      // Facility Buffer
      if (showBuffers) {
        const buffer = L.circle(fac.center, {
          radius: fac.bufferRadiusKm * 1000,
          color: '#64748b',
          weight: 1,
          dashArray: '5, 8',
          fillOpacity: 0.03,
        });
        layerGroup.addLayer(buffer);
      }

      // Known Thermal Zones
      if (showZones) {
        fac.knownThermalZones.forEach((zone) => {
          const zoneMarker = L.circle(zone.center, {
            radius: zone.radiusMeters,
            color: '#06b6d4',
            weight: 1.2,
            fillColor: '#0891b2',
            fillOpacity: 0.15,
          });

          zoneMarker.bindTooltip(
            `<span class="font-semibold text-cyan-400">Process Thermal Zone:</span> ${zone.name}<br/><span class="text-xs">Max Normal: ${zone.expectedMaxFrpMw} MW</span>`,
            { className: 'leaflet-custom-tooltip' }
          );

          layerGroup.addLayer(zoneMarker);
        });
      }
    });

    // Render Hotspots with Canonical Semantic Colors
    filteredEvents.forEach((ev) => {
      const isSelected = ev.id === selectedEventId;
      const isAmbiguous = ev.isAmbiguous;
      const assessment = getCanonicalAssessment(ev, facilities);

      // Marker radius based on FRP (5px to 18px)
      const radius = Math.min(18, Math.max(5, Math.sqrt(ev.frp) * 2.1));
      const fillColor = assessment.markerFillColor;
      const strokeColor = assessment.markerStrokeColor;

      // Subtle selection ring on selected event only (clean, no duplicate halos)
      if (isSelected) {
        const glowMarker = L.circleMarker([ev.latitude, ev.longitude], {
          radius: radius * 1.5,
          color: '#ffffff',
          weight: 2,
          opacity: 0.9,
          fillColor,
          fillOpacity: 0.25,
        });
        layerGroup.addLayer(glowMarker);
      }

      // Core Hotspot Marker
      const marker = L.circleMarker([ev.latitude, ev.longitude], {
        radius,
        color: isSelected ? '#ffffff' : strokeColor,
        weight: isSelected ? 3 : isAmbiguous ? 2.5 : 1.5,
        dashArray: isAmbiguous ? '3, 3' : undefined,
        fillColor,
        fillOpacity: 0.85,
      });

      marker.bindTooltip(
        `<div class="p-1 min-w-[190px]">
          <div class="font-bold flex items-center justify-between gap-1.5 ${assessment.textColor}">
            <span>${ev.id}</span>
            ${isAmbiguous ? '<span class="bg-amber-500/20 text-amber-300 text-[10px] px-1 rounded border border-amber-500/30">AMBIGUOUS</span>' : ''}
          </div>
          <div class="text-xs text-slate-300 mt-1 space-y-0.5">
            <div><strong>Facility:</strong> ${assessment.facilityName}</div>
            <div><strong>Association:</strong> ${assessment.spatialAssociationLabel}</div>
            <div><strong>Classification:</strong> <span class="${assessment.textColor} font-bold">${assessment.observationClassification}</span></div>
            <div><strong>FRP:</strong> ${ev.frp} MW | <strong>Temp:</strong> ${ev.brightness} K</div>
            <div><strong>Sensor:</strong> ${ev.satellite} (${ev.dayNight === 'D' ? 'Day' : 'Night'})</div>
          </div>
        </div>`,
        { className: 'leaflet-custom-tooltip' }
      );

      marker.on('click', () => {
        onSelectEvent(ev.id);
      });

      layerGroup.addLayer(marker);
    });
  }, [
    facilities,
    events,
    selectedEventId,
    selectedRegion,
    minFrp,
    selectedSatellite,
    showAmbiguousOnly,
    showPolygons,
    showZones,
    showBuffers,
  ]);

  // Pan to selected event or region
  const handleRegionChange = (region: string) => {
    setSelectedRegion(region);
    const map = mapInstanceRef.current;
    if (!map) return;

    if (region === 'west' || region === 'gujarat') {
      map.flyTo([22.0, 71.0], 7);
    } else if (region === 'east' || region === 'odisha') {
      map.flyTo([21.5, 85.5], 7);
    } else if (region === 'south') {
      map.flyTo([13.5, 78.5], 6);
    } else if (region === 'north_central') {
      map.flyTo([25.0, 80.0], 6);
    } else if (region === 'maharashtra') {
      map.flyTo([19.0, 73.5], 8);
    } else {
      map.flyTo([21.8, 77.0], 5);
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] flex overflow-hidden bg-slate-950">
      {/* Control Overlay Bar (Top Left) */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2 bg-slate-900/90 p-2 rounded-xl border border-slate-800 shadow-xl backdrop-blur-md max-w-[calc(100%-2rem)] sm:max-w-none">
        {/* Region Selector */}
        <select
          id="select-region"
          aria-label="Filter Map by Region"
          value={selectedRegion}
          onChange={(e) => handleRegionChange(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500"
        >
          <option value="all">All Monitored Regions (India - 80 Facilities)</option>
          <option value="west">Western Corridor (Gujarat, Maharashtra, Rajasthan)</option>
          <option value="east">Eastern Corridor (Odisha, West Bengal, Jharkhand, Bihar)</option>
          <option value="south">Southern Corridor (Tamil Nadu, AP, Telangana, Karnataka, Kerala)</option>
          <option value="north_central">Northern / Central Corridor (UP, MP, Chhattisgarh, Punjab, Assam)</option>
          <option value="gujarat">Gujarat PCPIR & Kutch (Jamnagar, Dahej, Hazira, Koyali)</option>
          <option value="odisha">Odisha Mineral & Coastal (Paradip, Angul, Rourkela)</option>
          <option value="maharashtra">Maharashtra Industrial (Trombay, Mahul, Dolvi, Thal)</option>
        </select>

        {/* Satellite Sensor Filter */}
        <select
          id="select-satellite"
          aria-label="Filter Map by Satellite Sensor"
          value={selectedSatellite}
          onChange={(e) => setSelectedSatellite(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500"
        >
          <option value="all">All Satellites (VIIRS + MODIS)</option>
          <option value="VIIRS-NOAA20">VIIRS (NOAA-20 NRT)</option>
          <option value="VIIRS-SNPP">VIIRS (Suomi-NPP)</option>
          <option value="MODIS-Aqua">MODIS (Aqua/Terra)</option>
        </select>

        {/* FRP Minimum Filter Slider */}
        <div className="flex items-center gap-2 px-2 py-1 bg-slate-800/80 rounded-lg border border-slate-700 text-xs">
          <span className="text-slate-400 font-mono">Min FRP:</span>
          <input
            id="slider-min-frp"
            aria-label="Minimum Fire Radiative Power (MW)"
            type="range"
            min="0"
            max="60"
            step="5"
            value={minFrp}
            onChange={(e) => setMinFrp(Number(e.target.value))}
            className="w-16 sm:w-24 accent-amber-500 cursor-pointer"
          />
          <span className="font-mono text-amber-400 w-8">{minFrp}MW</span>
        </div>

        {/* Ambiguity Toggle Switch */}
        <button
          id="btn-toggle-ambiguous"
          onClick={() => setShowAmbiguousOnly(!showAmbiguousOnly)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
            showAmbiguousOnly
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/10'
              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span>Ambiguous Only</span>
        </button>

        {/* Basemap Switcher */}
        <button
          id="btn-toggle-basemap"
          onClick={() => setTileMode(tileMode === 'satellite' ? 'dark' : 'satellite')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
        >
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span className="capitalize">{tileMode} Map</span>
        </button>

        {/* Live Satellite Feed Status Badge */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800 text-xs">
          {isLiveFirmsLoading ? (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span className="font-semibold text-[11px] tracking-wide">CONNECTING TO NASA FIRMS...</span>
            </div>
          ) : liveFeedInfo?.isLive ? (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 rounded-lg">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-semibold text-[11px] tracking-wide">NASA FIRMS LIVE</span>
              <span className="text-[10px] text-emerald-400/80 font-mono">({events.length} obs)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-950/40 border border-amber-800/50 text-amber-300 rounded-lg">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span className="font-semibold text-[11px] tracking-wide">HISTORICAL BASELINE ARCHIVE</span>
              <span className="text-[10px] text-amber-400/80 font-mono">({events.length} obs)</span>
            </div>
          )}

          {onRefreshLiveFeed && (
            <button
              id="btn-refresh-live-firms"
              onClick={onRefreshLiveFeed}
              disabled={isLiveFirmsLoading}
              title="Refresh live external satellite feed from NASA FIRMS"
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLiveFirmsLoading ? 'animate-spin text-amber-400' : 'text-slate-300'}`} />
            </button>
          )}
        </div>
      </div>

      {/* Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Map Legend Overlay (Bottom Left) */}
      <div className="absolute bottom-4 left-4 z-20 bg-slate-900/95 p-3 rounded-xl border border-slate-800 backdrop-blur shadow-2xl text-xs text-slate-300 space-y-2 hidden sm:block">
        <div className="font-semibold text-slate-100 flex items-center justify-between pb-1 border-b border-slate-800">
          <span>OBSERVATION CLASSIFICATION</span>
          <span className="text-[10px] text-cyan-400 font-mono">Primary State</span>
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#ef4444] border border-rose-400 shadow-sm shadow-rose-500/50" />
            <span><strong>ANOMALOUS</strong> · Significant deviation / extreme thermal behaviour</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#f59e0b] border border-amber-400 shadow-sm shadow-amber-500/50" />
            <span><strong>ELEVATED</strong> · Elevated thermal activity</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#10b981] border border-emerald-400 shadow-sm shadow-emerald-500/50" />
            <span><strong>NORMAL</strong> · Within expected thermal behaviour</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-slate-500 border border-slate-400" />
            <span><strong>NOT ASSESSED</strong> · Insufficient classification evidence</span>
          </div>
        </div>

        <div className="font-semibold text-slate-100 flex items-center justify-between pt-1.5 pb-0.5 border-t border-slate-800">
          <span>FACILITY ASSOCIATION</span>
          <span className="text-[10px] text-purple-400 font-mono">Secondary</span>
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm border border-sky-400 bg-sky-500/20" />
            <span>Known Process Zone (Stack / Furnace)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm border border-amber-400 bg-amber-500/20" />
            <span>Facility Off-Zone (Inside Boundary)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm border border-blue-400 bg-blue-500/20" />
            <span>Facility Buffer (Perimeter Envelope)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm border border-purple-400 bg-purple-500/20" />
            <span>Unassociated (Regional Detection)</span>
          </div>
        </div>
      </div>

      {/* Quick Inspector Drawer (Right Side) */}
      {selectedEvent && (() => {
        const selectedAssessment = getCanonicalAssessment(selectedEvent, facilities);

        return (
          <div className="absolute top-4 right-4 bottom-4 w-96 max-w-[calc(100%-2rem)] z-30 bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {selectedEvent.id}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${selectedAssessment.badgeStyle}`}
                    >
                      {selectedAssessment.observationClassification}
                    </span>
                    {selectedEvent.isRealData && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        LIVE NASA FIRMS
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-base text-slate-100 mt-1">
                    {selectedAssessment.facilityName}
                  </h3>
                  <p className="text-[11px] text-sky-400 font-medium mt-0.5">
                    {selectedAssessment.spatialAssociationLabel}
                  </p>
                </div>
                <button
                  onClick={() => onSelectEvent('')}
                  className="text-slate-400 hover:text-slate-200 text-lg leading-none p-1"
                >
                  &times;
                </button>
              </div>

              {/* Tri-Partite Intelligence Summary (3 Independent Dimensions) */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-2 text-xs">
                <div className="flex justify-between items-center pb-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400 font-medium">Observation Classification:</span>
                  <span className={`font-bold font-mono ${selectedAssessment.textColor}`}>
                    {selectedAssessment.observationClassification}
                  </span>
                </div>
                <div className="flex justify-between items-center pb-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400 font-medium">Facility Association:</span>
                  <span className={`font-mono font-semibold ${selectedAssessment.isAssociated ? 'text-sky-400' : 'text-purple-400'}`}>
                    {selectedAssessment.facilityAssociation}
                  </span>
                </div>
                <div className="flex justify-between items-center pb-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400 font-medium">Facility Baseline:</span>
                  <span className="text-slate-300 font-mono text-[11px]">
                    {selectedAssessment.baselineLabel}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Statistical Deviation:</span>
                  <span className="text-slate-300 font-mono text-[11px]">
                    {selectedAssessment.deviationRatioLabel}
                  </span>
                </div>
              </div>

            {/* Telemetry Stats Grid */}
            <div className="grid grid-cols-2 gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-xs">
              <div>
                <span className="text-slate-400">Radiative Power (FRP):</span>
                <p className="text-amber-400 font-mono font-bold text-base mt-0.5">
                  {selectedEvent.frp} MW
                </p>
              </div>
              <div>
                <span className="text-slate-400">Sensor / Pass:</span>
                <p className="text-slate-200 font-mono mt-0.5">
                  {selectedEvent.satellite} ({selectedEvent.dayNight === 'D' ? 'Day' : 'Night'})
                </p>
              </div>
              <div>
                <span className="text-slate-400">Brightness Temp:</span>
                <p className="text-slate-200 font-mono text-[11px] mt-0.5">
                  {selectedEvent.brightness} K
                </p>
              </div>
              <div>
                <span className="text-slate-400">Detection Confidence:</span>
                <p className="text-slate-200 font-mono text-[11px] mt-0.5 capitalize">
                  {selectedEvent.confidence}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Coordinates:</span>
                <p className="text-slate-300 font-mono text-[11px] mt-0.5">
                  {selectedEvent.latitude.toFixed(4)}, {selectedEvent.longitude.toFixed(4)}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Stack Proximity:</span>
                <p className="text-slate-300 font-mono text-[11px] mt-0.5">
                  {selectedEvent.facilityDistanceMeters > 0
                    ? `${selectedEvent.facilityDistanceMeters}m off-center`
                    : selectedFacility ? 'On Stack' : 'External Area'}
                </p>
              </div>
            </div>

            {/* Deviation Diagnosis Box */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/60 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                <Info className="w-4 h-4 text-sky-400" />
                <span>Behavioural & Spatial Diagnosis</span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                {selectedEvent.uncertaintyDetails}
              </p>
              {selectedFacility && (
                <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Stack Proximity: {selectedEvent.facilityDistanceMeters}m off-stack</span>
                  <span>Match Score: {selectedFacility.currentStatus.historicalMatchScore}/100</span>
                </div>
              )}
            </div>

            {/* Probable Source Hypotheses Breakdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  Source Hypotheses:
                </span>
                <span className="text-[10px] text-slate-400">
                  {selectedEvent.spatialAssociation === 'UNASSOCIATED' ? 'Regional Baseline' : 'Facility-Aware'}
                </span>
              </div>
              <div className="space-y-1.5">
                {(Object.keys(selectedEvent.sourceHypotheses) as (keyof typeof selectedEvent.sourceHypotheses)[]).map(
                  (key) => {
                    const prob = selectedEvent.sourceHypotheses[key];
                    if (prob < 0.02) return null;
                    return (
                      <div key={key} className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-300">{formatSourceLabel(key as any)}</span>
                          <span className="font-mono text-slate-400 font-bold">
                            {Math.round(prob * 100)}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              key === 'industrial_fire'
                                ? 'bg-rose-500'
                                : key === 'gas_flare'
                                ? 'bg-amber-500'
                                : 'bg-sky-500'
                            }`}
                            style={{ width: `${Math.round(prob * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 space-y-2">
            <button
              id="btn-launch-case-investigation"
              onClick={() => onNavigateToInvestigation(relatedCase?.caseId || selectedEvent.caseId || selectedEvent.id)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-semibold text-xs transition shadow-lg shadow-rose-500/20"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Launch Case Investigation ({relatedCase?.caseId || selectedEvent.id})</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            {selectedFacility && (
              <button
                id="btn-view-facility-baseline"
                onClick={() => onNavigateToFacility(selectedFacility.id)}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
              >
                <span>View Facility Thermal Baseline Profile</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
          </div>
        </div>
      );})()}
    </div>
  );
};
