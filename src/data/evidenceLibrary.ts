import { EvidenceItem } from '../types';

export const EVIDENCE_CATALOG: Record<string, EvidenceItem[]> = {
  'FIRMS-20260901-4821': [
    {
      id: 'EVID-JAM-S2-SWIR',
      type: 'SENTINEL2_SWIR',
      title: 'Sentinel-2 MSI Short-Wave Infrared (B12 / B11 / B8A Composite)',
      sensor: 'Sentinel-2B (MSI Level-2A)',
      acquisitionTimestamp: '2026-09-01T15:10:00Z (38m post-detection)',
      dataProvenance: 'CONTROLLED EVIDENCE SCENARIO',
      utilityScore: 94,
      costOrLatency: 'Immediate (Archive Revisit Available)',
      status: 'AVAILABLE',
      rationale: 'SWIR 2.2µm discriminates localized gas flare stacks (<10m concentrated source) from uncontained diffuse ground fires spread across storage bunds.',
      evidenceFindings: {
        spatialExpansion: true,
        uncontainedSpread: true,
        swirThermalPattern: 'diffuse_ground_fire',
        smokePlumeDetected: true,
        windAzimuthDegrees: 245,
        spectralIndex_NBR: -0.42, // strong combustion signal
        pixelFootprintSqMeters: 4200, // expanded way beyond flare stack 150m²
        summary: 'Controlled demonstration scenario: Simulated SWIR profile indicates an irregular, diffuse 4,200m² thermal area spanning the tank farm bunding (750m south of known flare stacks) with heavy particulate absorption, consistent with uncontained fire.',
      },
      simulatedBands: {
        swir22: '#ef4444',
        nir: '#f97316',
        trueColor: '#475569',
      },
      hypothesisShifts: {
        industrial_fire: +0.44, // 0.43 -> 0.71+
        gas_flare: -0.24,
        agricultural_burn: -0.07,
        wildfire: -0.04,
        mining_smelter: -0.05,
        other_thermal: -0.04,
      },
    },
    {
      id: 'EVID-JAM-OPTICAL-SMOKE',
      type: 'HIGH_RES_OPTICAL',
      title: 'High-Resolution Optical Plume & Shadow Vector Analysis',
      sensor: 'PlanetScope / Sentinel-2 RGB True Color (10m)',
      acquisitionTimestamp: '2026-09-01T15:10:00Z',
      dataProvenance: 'CONTROLLED EVIDENCE SCENARIO',
      utilityScore: 86,
      costOrLatency: 'Available in imagery cache',
      status: 'AVAILABLE',
      rationale: 'Identifies opaque black carbon smoke plume trajectory and ground scorch perimeter versus clean flare combustion.',
      evidenceFindings: {
        spatialExpansion: true,
        uncontainedSpread: true,
        swirThermalPattern: 'diffuse_ground_fire',
        smokePlumeDetected: true,
        windAzimuthDegrees: 245,
        spectralIndex_NBR: -0.38,
        pixelFootprintSqMeters: 3800,
        summary: 'Controlled demonstration scenario: Plume vector modeling indicates dense black smoke plume extending 1.8km east-northeast at 245° azimuth, originating from petroleum tank farm perimeter.',
      },
      hypothesisShifts: {
        industrial_fire: +0.28,
        gas_flare: -0.20,
        agricultural_burn: -0.04,
        wildfire: -0.02,
        mining_smelter: -0.01,
        other_thermal: -0.01,
      },
    },
    {
      id: 'EVID-JAM-TEMPORAL-REPEAT',
      type: 'TEMPORAL_REPEAT_PASS',
      title: 'VIIRS NOAA-20 / SNPP Sequential Overpass Delta (50-min gap)',
      sensor: 'Suomi-NPP VIIRS vs NOAA-20 VIIRS',
      acquisitionTimestamp: '2026-09-01T15:22:00Z',
      dataProvenance: 'DERIVED FROM REAL DATA',
      utilityScore: 78,
      costOrLatency: 'Automated Satellite Orbital Relay',
      status: 'AVAILABLE',
      rationale: 'Measures rapid FRP acceleration (+120% in 50 minutes) incompatible with regulated, steady-state flare burn rates.',
      evidenceFindings: {
        spatialExpansion: true,
        uncontainedSpread: true,
        swirThermalPattern: 'diffuse_ground_fire',
        smokePlumeDetected: true,
        windAzimuthDegrees: 245,
        spectralIndex_NBR: -0.45,
        pixelFootprintSqMeters: 5100,
        summary: 'Multi-pass delta: FRP escalated from 38.2 MW to 65.4 MW with centroid migration of 140 meters westward towards neighboring chemical storage, indicating active thermal progression.',
      },
      hypothesisShifts: {
        industrial_fire: +0.22,
        gas_flare: -0.16,
        agricultural_burn: -0.03,
        wildfire: -0.02,
        mining_smelter: -0.01,
        other_thermal: 0,
      },
    },
    {
      id: 'EVID-JAM-OSM-BUFFER',
      type: 'LAND_COVER_BUFFER',
      title: 'OpenStreetMap Infrastructure & Hazard Proximity Overlay',
      sensor: 'OSM Overpass API / Bhuvan Land Use',
      acquisitionTimestamp: '2026-09-01T14:35:00Z',
      dataProvenance: 'REAL',
      utilityScore: 72,
      costOrLatency: 'Real-time Vector Query',
      status: 'AVAILABLE',
      rationale: 'Verifies whether the anomaly intersects pressurized hydrocarbon lines, heavy tank storage, or non-flaring production units.',
      evidenceFindings: {
        spatialExpansion: false,
        uncontainedSpread: true,
        swirThermalPattern: 'diffuse_ground_fire',
        smokePlumeDetected: false,
        windAzimuthDegrees: 0,
        spectralIndex_NBR: 0,
        pixelFootprintSqMeters: 0,
        summary: 'GIS vector inspection: Hotspot is situated directly above Crude Oil Tank Farm Unit 14B (man-made bunded storage), 820m away from authorized flare stacks.',
      },
      hypothesisShifts: {
        industrial_fire: +0.15,
        gas_flare: -0.12,
        agricultural_burn: -0.02,
        wildfire: -0.01,
        mining_smelter: 0,
        other_thermal: 0,
      },
    },
  ],
  'FIRMS-20260901-7712': [
    {
      id: 'EVID-PAR-S2-SWIR',
      type: 'SENTINEL2_SWIR',
      title: 'Sentinel-2 SWIR Band 12 Thermal Spatial Confinement Check',
      sensor: 'Sentinel-2A MSI',
      acquisitionTimestamp: '2026-09-01T13:20:00Z',
      dataProvenance: 'CONTROLLED EVIDENCE SCENARIO',
      utilityScore: 92,
      costOrLatency: 'Available',
      status: 'AVAILABLE',
      rationale: 'Determine if high-intensity 52.8 MW thermal signal is confined to INDMAX cracker stack or uncontained naphtha leak.',
      evidenceFindings: {
        spatialExpansion: true,
        uncontainedSpread: true,
        swirThermalPattern: 'diffuse_ground_fire',
        smokePlumeDetected: true,
        windAzimuthDegrees: 180,
        spectralIndex_NBR: -0.35,
        pixelFootprintSqMeters: 2900,
        summary: 'Controlled demonstration scenario: Thermal emitter indicates elongation across pipeline rack corridor north of the catalytic cracker.',
      },
      hypothesisShifts: {
        industrial_fire: +0.38,
        gas_flare: -0.26,
        agricultural_burn: -0.05,
        wildfire: -0.04,
        mining_smelter: -0.02,
        other_thermal: -0.01,
      },
    },
  ],
  'HIST-20260107-N20-13': [
    {
      id: 'EVID-JAM-SCADA-METER',
      type: 'FACILITY_TELEMETRY',
      title: 'Facility SCADA Flare Gas Flow & Pressure Meter Log',
      sensor: 'Yokogawa Centum VP DCS / Ultrasonic Flare Meter',
      acquisitionTimestamp: '2026-01-07T21:14:00Z',
      dataProvenance: 'CONTROLLED EVIDENCE SCENARIO',
      utilityScore: 95,
      costOrLatency: 'Real-time DCS Telemetry Link',
      status: 'AVAILABLE',
      rationale: 'Direct mass flow telemetry indicates authorized relief of off-gas to flare stack cluster ZONE-JAM-01.',
      evidenceFindings: {
        spatialExpansion: false,
        uncontainedSpread: false,
        swirThermalPattern: 'point_flare_stack',
        smokePlumeDetected: false,
        windAzimuthDegrees: 45,
        spectralIndex_NBR: 0.12,
        pixelFootprintSqMeters: 140,
        summary: 'Controlled operational scenario: Simulated plant DCS flow telemetry indicates 4.2 t/h fuel gas relief to Elevated Flare Stack A2. Flow and temperature are consistent with routine operational flaring.',
      },
      hypothesisShifts: {
        gas_flare: +0.48,
        industrial_fire: -0.38,
        agricultural_burn: -0.04,
        wildfire: -0.03,
        mining_smelter: -0.02,
        other_thermal: -0.01,
      },
    },
    {
      id: 'EVID-JAM-VNF-COMBUSTION',
      type: 'SENTINEL2_SWIR',
      title: 'VIIRS Nightfire (VNF) Multi-Spectral Combustion Temperature',
      sensor: 'VIIRS Nightfire (M7-M8-M10-M12 Planck Fit)',
      acquisitionTimestamp: '2026-01-07T21:18:00Z',
      dataProvenance: 'DERIVED FROM REAL DATA',
      utilityScore: 88,
      costOrLatency: 'NOAA EOG Automated Pipeline',
      status: 'AVAILABLE',
      rationale: 'Determines physical combustion temperature: 1,750 K indicates methane flare gas combustion, whereas open pool fires rarely exceed 1,100 K.',
      evidenceFindings: {
        spatialExpansion: false,
        uncontainedSpread: false,
        swirThermalPattern: 'point_flare_stack',
        smokePlumeDetected: false,
        windAzimuthDegrees: 50,
        spectralIndex_NBR: 0.05,
        pixelFootprintSqMeters: 180,
        summary: 'Physical combustion modeling: Planck blackbody curve fits combustion temperature at 1,740 ± 65 K with concentrated source area 12 m², consistent with methane flaring.',
      },
      hypothesisShifts: {
        gas_flare: +0.35,
        industrial_fire: -0.28,
        agricultural_burn: -0.03,
        wildfire: -0.02,
        mining_smelter: -0.01,
        other_thermal: -0.01,
      },
    },
  ],
  'HIST-20260109-N20-20': [
    {
      id: 'EVID-REG-LANDCOVER-10M',
      type: 'LAND_COVER_BUFFER',
      title: 'Copernicus 10m Land Cover & Cropland Phenology Map',
      sensor: 'ESA WorldCover 10m / Bhuvan LULC',
      acquisitionTimestamp: '2026-01-09T08:00:00Z',
      dataProvenance: 'REAL',
      utilityScore: 92,
      costOrLatency: 'Static Vector Classification (Immediate)',
      status: 'AVAILABLE',
      rationale: 'High-resolution classification determines land cover is winter post-harvest cropland rather than forest canopy or industrial footprint.',
      evidenceFindings: {
        spatialExpansion: true,
        uncontainedSpread: false,
        swirThermalPattern: 'diffuse_ground_fire',
        smokePlumeDetected: true,
        windAzimuthDegrees: 310,
        spectralIndex_NBR: -0.25,
        pixelFootprintSqMeters: 1800,
        summary: 'Land cover classification: Point falls in active irrigated cropland parcel undergoing winter crop residue clearing. Zero industrial infrastructure within 12 km.',
      },
      hypothesisShifts: {
        agricultural_burn: +0.38,
        wildfire: -0.22,
        industrial_fire: -0.10,
        gas_flare: -0.04,
        mining_smelter: -0.01,
        other_thermal: -0.01,
      },
    },
    {
      id: 'EVID-REG-WIND-MET',
      type: 'HIGH_RES_OPTICAL',
      title: 'Local Surface Micro-Meteorology & Atmospheric Dispersion',
      sensor: 'IMD Automatic Weather Station (AWS)',
      acquisitionTimestamp: '2026-01-09T08:30:00Z',
      dataProvenance: 'REAL',
      utilityScore: 78,
      costOrLatency: 'Real-time IMD API',
      status: 'AVAILABLE',
      rationale: 'Wind speed 7 km/h and RH 42% are conducive to localized stubble burning with short smoke dispersion footprint.',
      evidenceFindings: {
        spatialExpansion: false,
        uncontainedSpread: false,
        swirThermalPattern: 'diffuse_ground_fire',
        smokePlumeDetected: true,
        windAzimuthDegrees: 310,
        spectralIndex_NBR: -0.20,
        pixelFootprintSqMeters: 1400,
        summary: 'Surface meteorological observation: Light surface winds (7.2 km/h from NW) with rapid thermal dissipation after 45 minutes, consistent with controlled field burn.',
      },
      hypothesisShifts: {
        agricultural_burn: +0.22,
        wildfire: -0.15,
        industrial_fire: -0.05,
        gas_flare: -0.01,
        mining_smelter: 0,
        other_thermal: -0.01,
      },
    },
  ],
};

// Aliases for historical benchmark cases
EVIDENCE_CATALOG['HIST-20260225-N-261'] = EVIDENCE_CATALOG['FIRMS-20260901-4821'];
EVIDENCE_CATALOG['CASE-20260225-N-261'] = EVIDENCE_CATALOG['FIRMS-20260901-4821'];
EVIDENCE_CATALOG['HIST-20260101-N20-1'] = EVIDENCE_CATALOG['HIST-20260107-N20-13'];
EVIDENCE_CATALOG['CASE-HIST-20260101-N20-1'] = EVIDENCE_CATALOG['HIST-20260107-N20-13'];
EVIDENCE_CATALOG['CASE-HIST-20260107-N20-13'] = EVIDENCE_CATALOG['HIST-20260107-N20-13'];
EVIDENCE_CATALOG['CASE-HIST-20260109-N20-20'] = EVIDENCE_CATALOG['HIST-20260109-N20-20'];

/**
 * Returns available Next-Best-Evidence items for benchmark cases, or empty array for arbitrary live observations
 */
export function getEvidenceForCase(caseId?: string, obsId?: string, isAssociated?: boolean): EvidenceItem[] {
  if (obsId && EVIDENCE_CATALOG[obsId]) return EVIDENCE_CATALOG[obsId];
  if (caseId && EVIDENCE_CATALOG[caseId]) return EVIDENCE_CATALOG[caseId];

  const cleanObsId = obsId ? obsId.replace(/^CASE-/, '') : '';
  if (cleanObsId && EVIDENCE_CATALOG[cleanObsId]) return EVIDENCE_CATALOG[cleanObsId];

  const cleanCaseId = caseId ? caseId.replace(/^CASE-/, '') : '';
  if (cleanCaseId && EVIDENCE_CATALOG[cleanCaseId]) return EVIDENCE_CATALOG[cleanCaseId];

  // For arbitrary live FIRMS observations outside curated benchmarks, do not invent evidence items
  return [];
}
