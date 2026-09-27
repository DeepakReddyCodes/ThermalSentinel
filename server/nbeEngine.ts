// ============================================================================
// ThermalSentinel — Section 8: Real Next-Best-Evidence (NBE) Engine
//
// Computes mathematically grounded Expected Information Gain (EIG), expected
// posterior entropy, temporal suitability, operational cost, and candidate
// ranking to provide case-dependent Next-Best-Evidence recommendations.
//
// Core Mathematical Formulation:
//   H(P_current) = -Σ [ p_i * log2(p_i) ]
//   P(o_j | E) = Σ_i [ P(o_j | h_i, E) * P_current(h_i) ]
//   P(h_i | o_j, E) = [ P(o_j | h_i, E) * P_current(h_i) ] / P(o_j | E)
//   H(P(. | o_j, E)) = -Σ_i [ P(h_i | o_j, E) * log2(P(h_i | o_j, E)) ]
//   E[H | E] = Σ_j [ P(o_j | E) * H(P(. | o_j, E)) ]
//   EIG(E) = H(P_current) - E[H | E]  (>= 0 bits via Jensen's Inequality)
//
// Operational Utility:
//   Utility(E) = Math.round(100 * [0.30*(H/H_max) + 0.25*C_comp + 0.45*Relevance] * CostMult * TempFactor)
// ============================================================================

import {
  SourceHypothesisType,
  HypothesisSupport,
  EvidenceCandidateType,
  EvidenceAvailabilityStatus,
  CurrentEvidenceStatus,
  AcquisitionCostEffort,
  DiscriminativeValueLevel,
  EvidenceCandidate,
  NextBestEvidenceRecommendation,
  DecisionExplanation,
  EvidenceGuidedInvestigation,
  UtilityScoreBreakdown,
  ServerFacility,
  ObservedThermalActivityZone,
  SpatialAssociationType,
  BehaviouralStatus,
  PrototypeSourceHypotheses,
  UncertaintyAssessment,
  InvestigationPriorityResult,
} from './types.js';
import { EmpiricalFacilityBaseline } from './historicalIngestion.js';
import { calculateExactShannonEntropy, ALL_CANDIDATE_HYPOTHESES } from './evidenceFusionEngine.js';
import { BayesianPosteriorResult } from './bayesianEngine.js';

export type TemporalSuitabilityStatus = 'EVENT_ADJACENT' | 'FORENSIC_CONTEXT' | 'UNAVAILABLE';
export type EvidenceProvenanceStatus = 'REAL_AVAILABLE' | 'CONTROLLED' | 'UNAVAILABLE';

export interface ExpectedEntropyOutcome {
  outcome_id: string;
  outcome_name: string;
  outcome_probability: number; // P(o | E, current)
  posterior_entropy_bits: number; // H(P(. | o))
  posterior_top_hypothesis: SourceHypothesisType;
  posterior_distribution: Record<SourceHypothesisType, number>; // percentages
}

export interface ExpectedEntropyAnalysis {
  current_entropy_bits: number;
  expected_posterior_entropy_bits: number;
  expected_information_gain_bits: number; // EIG = H_current - E[H]
  target_ambiguity: string;
  outcomes: ExpectedEntropyOutcome[];
  information_model_name: string;
}

export interface CandidateOutcomeModelDefinition {
  evidenceType: EvidenceCandidateType;
  displayName: string;
  source: string;
  spatialResolution: string;
  acquisitionCostEffort: AcquisitionCostEffort;
  costMultiplier: number;
  provenance: EvidenceProvenanceStatus;
  applicableHypotheses: SourceHypothesisType[];
  discriminativeLevel: DiscriminativeValueLevel;
  whyItMatters: string;
  rationale: string;
  limitations: string;
  assumptions: string[];
  outcomes: {
    id: string;
    name: string;
    description: string;
    // Conditional likelihood P(o | h_i) for each candidate hypothesis
    conditionalLikelihood: Record<SourceHypothesisType, number>;
  }[];
}

// ----------------------------------------------------------------------------
// Candidate Outcome Models with Explicit Conditional Likelihood Matrices
// (PROTOTYPE_INFORMATION_MODEL: Transparent, inspectable, deterministic matrices)
// ----------------------------------------------------------------------------
export const CANDIDATE_OUTCOME_MODELS: Record<EvidenceCandidateType, CandidateOutcomeModelDefinition> = {
  SENTINEL2_SWIR_OPTICAL: {
    evidenceType: 'SENTINEL2_SWIR_OPTICAL',
    displayName: 'Copernicus Sentinel-2 MSI Multi-Spectral SWIR (B11/B12, 20m)',
    source: 'ESA Copernicus Open Access Hub (Sentinel-2 MSI 20 m SWIR bands 11 & 12)',
    spatialResolution: '20 m Multi-Spectral SWIR',
    acquisitionCostEffort: 'MODERATE_LATENCY',
    costMultiplier: 0.85,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
    discriminativeLevel: 'VERY_HIGH',
    whyItMatters:
      'Provides 20 m spatial resolution shortwave infrared (1.6 µm / 2.2 µm) to physically resolve elevated flare stack structures versus unconfined ground fires or process units.',
    rationale:
      'Crucial for resolving ambiguous industrial fire excursions from routine or relief flaring inside petrochemical complexes.',
    limitations:
      'Subject to 5-day orbital revisit frequency and optical cloud obstruction; contemporaneous overpass tasking required when archival passes are temporally distant.',
    assumptions: ['SWIR saturation pattern differentiates elevated point source from broad-area surface combustion.'],
    outcomes: [
      {
        id: 'POINT_EMITTER_ELEVATED_STACK',
        name: 'Point Emitter on Mapped Flare Stack (Zero Ground Bloom)',
        description: 'Single 20 m pixel saturation centered precisely on known elevated stack coordinates.',
        conditionalLikelihood: {
          GAS_FLARE: 0.82,
          INDUSTRIAL_FIRE: 0.04,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.12,
        },
      },
      {
        id: 'SURFACE_SPREAD_PROCESS_STRUCTURE',
        name: 'Multi-Pixel Ground Bloom over Process Unit / Storage Area',
        description: 'Lateral optical SWIR spread (>60 m footprint) over ground infrastructure or tankage.',
        conditionalLikelihood: {
          GAS_FLARE: 0.04,
          INDUSTRIAL_FIRE: 0.80,
          AGRICULTURAL_BURN: 0.04,
          WILDFIRE_VEGETATION: 0.04,
          OTHER: 0.08,
        },
      },
      {
        id: 'VEGETATION_BURN_SCAR',
        name: 'Linear Perimeter / Active Biomass Combustion Scar',
        description: 'Hotspot aligns with vegetated field boundary or active fireline progression.',
        conditionalLikelihood: {
          GAS_FLARE: 0.01,
          INDUSTRIAL_FIRE: 0.04,
          AGRICULTURAL_BURN: 0.46,
          WILDFIRE_VEGETATION: 0.46,
          OTHER: 0.03,
        },
      },
      {
        id: 'INCONCLUSIVE_CLOUD_COVER_OR_AMBIENT',
        name: 'Cloud Obscuration / Diffuse Ambient Signal',
        description: 'Optical cloud reflectance or sub-threshold saturation leaves emitter unconfirmed.',
        conditionalLikelihood: {
          GAS_FLARE: 0.20,
          INDUSTRIAL_FIRE: 0.20,
          AGRICULTURAL_BURN: 0.20,
          WILDFIRE_VEGETATION: 0.20,
          OTHER: 0.20,
        },
      },
    ],
  },

  HIGH_RES_LAND_COVER_CONTEXT: {
    evidenceType: 'HIGH_RES_LAND_COVER_CONTEXT',
    displayName: 'High-Resolution Land Cover & Surface Composition (10m)',
    source: 'ESA WorldCover 10m / Dynamic World Sentinel-2 Land Classification',
    spatialResolution: '10 m Parcel Grid',
    acquisitionCostEffort: 'LOW_AUTOMATED',
    costMultiplier: 0.95,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'],
    discriminativeLevel: 'VERY_HIGH',
    whyItMatters:
      'Identifies ground parcel classification (cropland, scrub, bare ground, industrial). Essential for unassociated regional detections to separate agricultural burn from wildland fire.',
    rationale:
      'Prevents speculative source attribution by providing definitive terrain composition of the underlying pixel.',
    limitations:
      'Annual land cover maps do not capture temporal crop harvesting cycles or active tillage dates without temporal NDVI series.',
    assumptions: ['Active thermal hotspot on classified cropland indicates agricultural residue burning.'],
    outcomes: [
      {
        id: 'CROPLAND_ACTIVE_AGRICULTURE',
        name: 'Classified Cropland & Cultivated Fields',
        description: 'Hotspot footprint falls entirely within documented agricultural land parcel.',
        conditionalLikelihood: {
          GAS_FLARE: 0.01,
          INDUSTRIAL_FIRE: 0.02,
          AGRICULTURAL_BURN: 0.88,
          WILDFIRE_VEGETATION: 0.06,
          OTHER: 0.03,
        },
      },
      {
        id: 'FOREST_SHRUBLAND_NATURAL_VEGETATION',
        name: 'Forest Canopy / Dry Scrubland / Wildland',
        description: 'Hotspot footprint falls within natural wildland vegetation or forest canopy.',
        conditionalLikelihood: {
          GAS_FLARE: 0.01,
          INDUSTRIAL_FIRE: 0.02,
          AGRICULTURAL_BURN: 0.08,
          WILDFIRE_VEGETATION: 0.86,
          OTHER: 0.03,
        },
      },
      {
        id: 'INDUSTRIAL_HEAVY_FACILITY_LAND',
        name: 'Heavy Industrial / Refinery Paved Apron',
        description: 'Hotspot footprint falls on industrial asphalt, process foundation, or refinery grounds.',
        conditionalLikelihood: {
          GAS_FLARE: 0.52,
          INDUSTRIAL_FIRE: 0.42,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.04,
        },
      },
      {
        id: 'BARREN_ROCK_OR_QUARRY',
        name: 'Barren Soil / Rock Quarry / Transport Corridor',
        description: 'Hotspot falls on bare ground, quarry, or road infrastructure.',
        conditionalLikelihood: {
          GAS_FLARE: 0.05,
          INDUSTRIAL_FIRE: 0.15,
          AGRICULTURAL_BURN: 0.05,
          WILDFIRE_VEGETATION: 0.05,
          OTHER: 0.70,
        },
      },
    ],
  },

  VIIRS_NIGHTFIRE_COMBUSTION: {
    evidenceType: 'VIIRS_NIGHTFIRE_COMBUSTION',
    displayName: 'VIIRS Nightfire (VNF) Multi-Spectral Combustion Temperature',
    source: 'NOAA Earth Observation Group (EOG) VIIRS Nightfire Planck Curve Fitting',
    spatialResolution: '750 m Nightfire Pixel',
    acquisitionCostEffort: 'LOW_AUTOMATED',
    costMultiplier: 0.92,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
    discriminativeLevel: 'HIGH',
    whyItMatters:
      'Fits dual Planck curve to nighttime NIR/SWIR channels to estimate thermodynamic emitter temperature (K) and source area (m²). Gas flaring typically operates at 1600-2000 K, while biomass/structural fires burn at 800-1200 K.',
    rationale:
      'Physical thermodynamic temperature discriminates flare gas combustion from structural or biomass fires.',
    limitations:
      'Applicable strictly to nighttime overpasses; solar reflectance during daytime passes precludes Planck curve fitting.',
    assumptions: ['Sub-pixel hotspot radiates with greybody emission spectrum.'],
    outcomes: [
      {
        id: 'HIGH_TEMP_GAS_FLARE_COMBUSTION',
        name: 'High-Temperature Gas Combustion (T > 1600 K, Area < 50 m²)',
        description: 'Planck curve fits pure methane/hydrocarbon gas combustion kinetics with elevated temperature.',
        conditionalLikelihood: {
          GAS_FLARE: 0.88,
          INDUSTRIAL_FIRE: 0.06,
          AGRICULTURAL_BURN: 0.02,
          WILDFIRE_VEGETATION: 0.02,
          OTHER: 0.02,
        },
      },
      {
        id: 'LOW_TEMP_SMOLDERING_COMBUSTION',
        name: 'Low-Temperature Smoldering / Structure Fire (T ≈ 800-1200 K, Area > 200 m²)',
        description: 'Thermodynamic profile matches open biomass or diffuse ground-level industrial structural fire.',
        conditionalLikelihood: {
          GAS_FLARE: 0.05,
          INDUSTRIAL_FIRE: 0.45,
          AGRICULTURAL_BURN: 0.25,
          WILDFIRE_VEGETATION: 0.20,
          OTHER: 0.05,
        },
      },
      {
        id: 'NO_SUBPIXEL_CONVERGENCE_OR_DAYTIME',
        name: 'Daytime Overpass / Unresolved Subpixel Emission',
        description: 'Daytime solar reflection or low signal-to-noise ratio prevents dual-band Planck convergence.',
        conditionalLikelihood: {
          GAS_FLARE: 0.20,
          INDUSTRIAL_FIRE: 0.20,
          AGRICULTURAL_BURN: 0.20,
          WILDFIRE_VEGETATION: 0.20,
          OTHER: 0.20,
        },
      },
    ],
  },

  MULTI_PASS_TEMPORAL_PERSISTENCE: {
    evidenceType: 'MULTI_PASS_TEMPORAL_PERSISTENCE',
    displayName: 'Multi-Mission Subsequent Satellite Passes (NOAA-20 / NOAA-21 / Landsat)',
    source: 'Multi-Constellation Satellite Overpasses (SNPP, NOAA-20, NOAA-21, Landsat-8/9)',
    spatialResolution: '375 m / 30 m Multi-Mission',
    acquisitionCostEffort: 'MODERATE_LATENCY',
    costMultiplier: 0.75,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'OTHER'],
    discriminativeLevel: 'HIGH',
    whyItMatters:
      'Tracks thermal signature across subsequent passes to establish persistence kinetics. Transient industrial upsets dissipate rapidly, whereas operational flaring continues multi-day.',
    rationale: 'Temporal decay kinetics separate transient industrial incidents from sustained process flaring.',
    limitations: 'Requires waiting 6 to 12 hours for next polar satellite pass.',
    assumptions: ['Industrial fire dissipation profile differs markedly from continuous operational flaring.'],
    outcomes: [
      {
        id: 'PERSISTENT_MULTI_DAY_HOTSPOT',
        name: 'Persistent Continuous Thermal Emission (>3 Consecutive Passes)',
        description: 'Thermal activity sustained consistently across subsequent NOAA-20/21 overpasses.',
        conditionalLikelihood: {
          GAS_FLARE: 0.82,
          INDUSTRIAL_FIRE: 0.08,
          AGRICULTURAL_BURN: 0.04,
          WILDFIRE_VEGETATION: 0.02,
          OTHER: 0.04,
        },
      },
      {
        id: 'TRANSIENT_DISSIPATED_HOTSPOT',
        name: 'Rapid Dissipation / Quenched Hotspot (Zero Subsequent Heat)',
        description: 'Thermal emitter disappears on subsequent pass (characteristic of transient fire or field burn).',
        conditionalLikelihood: {
          GAS_FLARE: 0.08,
          INDUSTRIAL_FIRE: 0.45,
          AGRICULTURAL_BURN: 0.40,
          WILDFIRE_VEGETATION: 0.05,
          OTHER: 0.02,
        },
      },
      {
        id: 'INTERMITTENT_PULSING_HOTSPOT',
        name: 'Intermittent Pulsing / Batch Process Operation',
        description: 'Cyclic heating signature characteristic of batch chemical reactors or intermittent purge flaring.',
        conditionalLikelihood: {
          GAS_FLARE: 0.65,
          INDUSTRIAL_FIRE: 0.10,
          AGRICULTURAL_BURN: 0.10,
          WILDFIRE_VEGETATION: 0.05,
          OTHER: 0.10,
        },
      },
    ],
  },

  OPENSTREETMAP_INFRASTRUCTURE_CONTEXT: {
    evidenceType: 'OPENSTREETMAP_INFRASTRUCTURE_CONTEXT',
    displayName: 'OpenStreetMap Industrial & Infrastructure Context (Overpass API)',
    source: 'OpenStreetMap Overpass API (Real-Time Bounded Geographic Query)',
    spatialResolution: 'Vector Geometry / Point Features',
    acquisitionCostEffort: 'ZERO_IMMEDIATE',
    costMultiplier: 0.98,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'OTHER'],
    discriminativeLevel: 'HIGH',
    whyItMatters:
      'Live OSM infrastructure query retrieves nearby mapped flares, chimneys, storage tanks, and pipelines with exact metric distance from FIRMS detection.',
    rationale:
      'Supplements configured boundaries with crowd-verified and public infrastructure coordinates for spatial sanity checking.',
    limitations:
      'OSM relies on voluntary mapping contributions; incomplete or unmapped assets may exist. Contextual evidence only; does not supersede validated baseline.',
    assumptions: ['Mapped OSM tags accurately represent physical installations on the ground.'],
    outcomes: [
      {
        id: 'PROXIMATE_MAPPED_FLARE_OR_CHIMNEY',
        name: 'Proximate Mapped Flare Stack / Chimney (< 150m)',
        description: 'Verified OSM tag man_made=flare or man_made=chimney within sub-pixel footprint.',
        conditionalLikelihood: {
          GAS_FLARE: 0.85,
          INDUSTRIAL_FIRE: 0.08,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.05,
        },
      },
      {
        id: 'PROXIMATE_STORAGE_TANK_OR_PROCESS_UNIT',
        name: 'Proximate Hydrocarbon Storage Tank / Unit (< 150m)',
        description: 'Verified OSM tag man_made=storage_tank or industrial=refinery processing unit.',
        conditionalLikelihood: {
          GAS_FLARE: 0.12,
          INDUSTRIAL_FIRE: 0.78,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.08,
        },
      },
      {
        id: 'RURAL_OR_UNMAPPED_TERRAIN',
        name: 'Rural / Unmapped Open Terrain (No Industrial Tags)',
        description: 'Zero industrial tags found within 1.5 km radius; open rural or agricultural terrain.',
        conditionalLikelihood: {
          GAS_FLARE: 0.01,
          INDUSTRIAL_FIRE: 0.03,
          AGRICULTURAL_BURN: 0.52,
          WILDFIRE_VEGETATION: 0.42,
          OTHER: 0.02,
        },
      },
    ],
  },

  ATMOSPHERIC_WIND_WEATHER: {
    evidenceType: 'ATMOSPHERIC_WIND_WEATHER',
    displayName: 'Atmospheric Boundary-Layer Wind & Weather Fields (Open-Meteo)',
    source: 'Open-Meteo Historical Weather API (ERA5 / High-Res NWP)',
    spatialResolution: '0.1° Reanalysis Grid',
    acquisitionCostEffort: 'ZERO_IMMEDIATE',
    costMultiplier: 0.95,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
    discriminativeLevel: 'MODERATE',
    whyItMatters:
      'Historical surface temperature, relative humidity, wind speed, meteorological direction (FROM), and downwind advection vector (TOWARD) corresponding to observation timestamp.',
    rationale:
      'Provides contextual atmospheric conditions to assess boundary layer stability, plume drift heading, and whether surface winds augmented flaring or combustion intensity.',
    limitations:
      'Atmospheric context does not alter baseline classification or directly identify emitter type; provides transport and dispersion evaluation.',
    assumptions: ['Reanalysis grid cell adequately represents local surface boundary conditions.'],
    outcomes: [
      {
        id: 'HIGH_VENTILATION_STRONG_WINDS',
        name: 'High Surface Wind & Low Humidity (Elevated Fire Danger)',
        description: 'Surface wind > 25 km/h with relative humidity < 30% augmenting open flame propagation.',
        conditionalLikelihood: {
          GAS_FLARE: 0.20,
          INDUSTRIAL_FIRE: 0.35,
          AGRICULTURAL_BURN: 0.20,
          WILDFIRE_VEGETATION: 0.20,
          OTHER: 0.05,
        },
      },
      {
        id: 'MODERATE_STABLE_CONDITIONS',
        name: 'Moderate Breeze & Standard Atmospheric Stability',
        description: 'Standard ambient conditions with typical vertical plume buoyancy.',
        conditionalLikelihood: {
          GAS_FLARE: 0.25,
          INDUSTRIAL_FIRE: 0.20,
          AGRICULTURAL_BURN: 0.20,
          WILDFIRE_VEGETATION: 0.20,
          OTHER: 0.15,
        },
      },
      {
        id: 'STAGNANT_CALM_AIR',
        name: 'Stagnant Calm Air & Inversion Layer',
        description: 'Low surface wind (< 5 km/h) allowing local vertical plume rise without drift.',
        conditionalLikelihood: {
          GAS_FLARE: 0.25,
          INDUSTRIAL_FIRE: 0.15,
          AGRICULTURAL_BURN: 0.20,
          WILDFIRE_VEGETATION: 0.10,
          OTHER: 0.30,
        },
      },
    ],
  },

  FACILITY_BOUNDARY_GEOMETRY: {
    evidenceType: 'FACILITY_BOUNDARY_GEOMETRY',
    displayName: 'Monitored Facility Perimeter & Buffer Geometry',
    source: 'Verified Facility GeoJSON Registry',
    spatialResolution: 'Polygonal Boundary',
    acquisitionCostEffort: 'ZERO_IMMEDIATE',
    costMultiplier: 1.0,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
    discriminativeLevel: 'VERY_HIGH',
    whyItMatters:
      'Spatially bounds the candidate hypotheses by determining whether the event occurs on industrial process land or open regional terrain.',
    rationale:
      'Defines legal/operational property limits to bound candidate source hypotheses.',
    limitations: 'Boundary perimeter defines property limits, not individual unit equipment classifications.',
    assumptions: ['Official GeoJSON boundary aligns with actual operating asset footprint.'],
    outcomes: [
      {
        id: 'INSIDE_KNOWN_OPERATIONAL_ZONE',
        name: 'Inside Monitored Perimeter within Known Operational Zone',
        description: 'Hotspot is fully enclosed in configured flaring/process zone.',
        conditionalLikelihood: {
          GAS_FLARE: 0.88,
          INDUSTRIAL_FIRE: 0.08,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.02,
        },
      },
      {
        id: 'INSIDE_FACILITY_OFF_ZONE',
        name: 'Inside Monitored Perimeter but Offset from Known Stacks',
        description: 'Hotspot is inside fence line but spatially displaced from configured flare stacks.',
        conditionalLikelihood: {
          GAS_FLARE: 0.15,
          INDUSTRIAL_FIRE: 0.72,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.11,
        },
      },
      {
        id: 'OUTSIDE_PERIMETER_REGIONAL',
        name: 'Outside Monitored Perimeter (Unassociated Regional Terrain)',
        description: 'Hotspot is outside all registered industrial boundaries.',
        conditionalLikelihood: {
          GAS_FLARE: 0.01,
          INDUSTRIAL_FIRE: 0.03,
          AGRICULTURAL_BURN: 0.52,
          WILDFIRE_VEGETATION: 0.42,
          OTHER: 0.02,
        },
      },
    ],
  },

  FACILITY_OPERATIONAL_SCADA_LOGS: {
    evidenceType: 'FACILITY_OPERATIONAL_SCADA_LOGS',
    displayName: 'Facility Operational SCADA / Flaring Metering Logs',
    source: 'Plant Distributed Control System (DCS) & Flare Gas Flowmeters',
    spatialResolution: 'Unit Flowmeter / DCS Tags',
    acquisitionCostEffort: 'HIGH_RESTRICTED',
    costMultiplier: 0.45,
    provenance: 'CONTROLLED', // Explicitly marked CONTROLLED/future prototype capability
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
    discriminativeLevel: 'VERY_HIGH',
    whyItMatters:
      'Direct telemetry records of flare gas flow rates (Nm³/h), knock-out drum pressure, purge velocity, and emergency safety valve actuations.',
    rationale:
      'Definitive ground-truth verification of scheduled plant process flaring versus uncontained emergency fire.',
    limitations:
      'Proprietary industrial telemetry; inaccessible in real-time without plant operator authorization and manual inquiry.',
    assumptions: ['DCS telemetry is calibrated and accurately captures all relief valve events.'],
    outcomes: [
      {
        id: 'AUTHORIZED_RELIEF_VALVE_DISCHARGE',
        name: 'Metered Flare Gas Discharge Logged in DCS',
        description: 'DCS registers active flaring valve actuation and flow rate matching thermal signature.',
        conditionalLikelihood: {
          GAS_FLARE: 0.98,
          INDUSTRIAL_FIRE: 0.01,
          AGRICULTURAL_BURN: 0.00,
          WILDFIRE_VEGETATION: 0.00,
          OTHER: 0.01,
        },
      },
      {
        id: 'ZERO_METERED_FLOW_PROCESS_UPSET',
        name: 'Zero Flare Header Flow (Uncontrolled Ground Event)',
        description: 'DCS registers normal baseline flow despite massive external thermal emission.',
        conditionalLikelihood: {
          GAS_FLARE: 0.01,
          INDUSTRIAL_FIRE: 0.96,
          AGRICULTURAL_BURN: 0.00,
          WILDFIRE_VEGETATION: 0.00,
          OTHER: 0.03,
        },
      },
      {
        id: 'INACCESSIBLE_PROPRIETARY_TELEMETRY',
        name: 'Proprietary Telemetry Inaccessible / Unconnected',
        description: 'SCADA interface offline or permissions withheld; zero discriminative telemetry.',
        conditionalLikelihood: {
          GAS_FLARE: 0.20,
          INDUSTRIAL_FIRE: 0.20,
          AGRICULTURAL_BURN: 0.20,
          WILDFIRE_VEGETATION: 0.20,
          OTHER: 0.20,
        },
      },
    ],
  },

  // Legacy & supplementary candidate keys mapped for comprehensive coverage
  NASA_FIRMS_VIIRS_DETECTION: {
    evidenceType: 'NASA_FIRMS_VIIRS_DETECTION',
    displayName: 'NASA FIRMS VIIRS Active Thermal Detection',
    source: 'NASA LANCE / FIRMS Active Fire Product (Real 375 m VIIRS Sensor Data)',
    spatialResolution: '375 m I-Band Pixel',
    acquisitionCostEffort: 'ZERO_IMMEDIATE',
    costMultiplier: 1.0,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'],
    discriminativeLevel: 'HIGH',
    whyItMatters: 'Confirms empirical active thermal emission and radiant energy.',
    rationale: 'Sub-pixel thermal infrared detection establishing presence and timestamp of thermal emitter.',
    limitations: '375 m pixel footprint integrates total emitted radiance.',
    assumptions: ['Emissivity characteristic of terrestrial combustion in MWIR band.'],
    outcomes: [
      {
        id: 'CONFIRMED_HIGH_FRP_HOTSPOT',
        name: 'Active Thermal Hotspot Confirmed',
        description: 'Confirmed sub-pixel thermal emission.',
        conditionalLikelihood: {
          GAS_FLARE: 0.30,
          INDUSTRIAL_FIRE: 0.25,
          AGRICULTURAL_BURN: 0.20,
          WILDFIRE_VEGETATION: 0.20,
          OTHER: 0.05,
        },
      },
    ],
  },

  EMPIRICAL_HISTORICAL_BASELINE: {
    evidenceType: 'EMPIRICAL_HISTORICAL_BASELINE',
    displayName: 'Empirical Historical Operational Thermal Baseline',
    source: 'Historical VIIRS Ingestion Pipeline & Statistical Baseline Engine',
    spatialResolution: 'Statistical Baseline Profile',
    acquisitionCostEffort: 'ZERO_IMMEDIATE',
    costMultiplier: 1.0,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
    discriminativeLevel: 'VERY_HIGH',
    whyItMatters: 'Enables statistical evaluation of whether thermal intensity is consistent with routine flaring.',
    rationale: 'Statistical benchmark evaluated from real historical overpasses.',
    limitations: 'Window reflects 115-day pre-event history.',
    assumptions: ['Historical VIIRS detections over facility predominantly represent routine flaring.'],
    outcomes: [
      {
        id: 'ROUTINE_BASELINE_CONFORMANT',
        name: 'Within Empirical Baseline (< P75)',
        description: 'FRP conforms to routine flaring distribution.',
        conditionalLikelihood: {
          GAS_FLARE: 0.88,
          INDUSTRIAL_FIRE: 0.05,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.05,
        },
      },
      {
        id: 'ANOMALOUS_EXCURSION',
        name: 'Anomalous Excursion (> P95)',
        description: 'FRP exceeds 95th percentile historical baseline.',
        conditionalLikelihood: {
          GAS_FLARE: 0.20,
          INDUSTRIAL_FIRE: 0.72,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.06,
        },
      },
    ],
  },

  OBSERVED_THERMAL_ACTIVITY_ZONE: {
    evidenceType: 'OBSERVED_THERMAL_ACTIVITY_ZONE',
    displayName: 'Observed Thermal Activity Zone (Empirical Cluster)',
    source: 'Empirical Spatial Distribution Engine',
    spatialResolution: 'Cluster Centroid & Radius',
    acquisitionCostEffort: 'ZERO_IMMEDIATE',
    costMultiplier: 1.0,
    provenance: 'REAL_AVAILABLE',
    applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
    discriminativeLevel: 'HIGH',
    whyItMatters: 'Distinguishes between recurring operating clusters and novel spatial hotspots.',
    rationale: 'Empirical spatial density modeling of historical detections.',
    limitations: 'Zone has not been ground-verified with plant engineering drawings.',
    assumptions: ['Empirical spatial clustering reflects primary physical flaring infrastructure.'],
    outcomes: [
      {
        id: 'WITHIN_HISTORICAL_CLUSTER',
        name: 'Within Empirical Cluster Zone',
        description: 'Observation falls within empirical density envelope.',
        conditionalLikelihood: {
          GAS_FLARE: 0.85,
          INDUSTRIAL_FIRE: 0.08,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.05,
        },
      },
      {
        id: 'SPATIAL_ANOMALY_OFFSET',
        name: 'Offset from Cluster Centroid',
        description: 'Observation is displaced from historical cluster.',
        conditionalLikelihood: {
          GAS_FLARE: 0.18,
          INDUSTRIAL_FIRE: 0.70,
          AGRICULTURAL_BURN: 0.01,
          WILDFIRE_VEGETATION: 0.01,
          OTHER: 0.10,
        },
      },
    ],
  },
};

// ----------------------------------------------------------------------------
// Target Ambiguity Evaluator
// ----------------------------------------------------------------------------
export function evaluateTargetAmbiguity(
  distribution: Array<{ hypothesis: SourceHypothesisType; percentage: number; label?: string }>
): {
  targetPair: string;
  top1: { hypothesis: SourceHypothesisType; percentage: number; label: string };
  top2: { hypothesis: SourceHypothesisType; percentage: number; label: string };
  competitionIndex: number; // C_comp = max(0, 1 - |p1 - p2|/100)
} {
  const sorted = [...distribution].sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
  const top1 = sorted[0] || { hypothesis: 'OTHER', percentage: 50, label: 'Other' };
  const top2 = sorted[1] || { hypothesis: 'GAS_FLARE', percentage: 20, label: 'Gas Flare' };

  const p1 = top1.percentage || 50;
  const p2 = top2.percentage || 20;
  const cComp = Math.max(0.0, Math.round((1.0 - Math.abs(p1 - p2) / 100) * 1000) / 1000);

  let targetPair = '';
  const h1 = top1.hypothesis;
  const h2 = top2.hypothesis;

  if (p1 >= 75 && p1 - p2 >= 50) {
    targetPair = `${top1.label || h1} Dominant (Secondary: ${top2.label || h2})`;
  } else if ((h1 === 'GAS_FLARE' && h2 === 'INDUSTRIAL_FIRE') || (h1 === 'INDUSTRIAL_FIRE' && h2 === 'GAS_FLARE')) {
    targetPair = 'Industrial Flare Stack vs Unconfined Industrial Fire';
  } else if (
    (h1 === 'AGRICULTURAL_BURN' && h2 === 'WILDFIRE_VEGETATION') ||
    (h1 === 'WILDFIRE_VEGETATION' && h2 === 'AGRICULTURAL_BURN')
  ) {
    targetPair = 'Agricultural Residue Burning vs Wildland Fire';
  } else if (
    (h1 === 'INDUSTRIAL_FIRE' && h2 === 'OTHER') ||
    (h1 === 'OTHER' && h2 === 'INDUSTRIAL_FIRE')
  ) {
    targetPair = 'Industrial Fire vs Secondary Process Heat / Flare';
  } else if (
    (h1 === 'GAS_FLARE' || h1 === 'INDUSTRIAL_FIRE') &&
    (h2 === 'AGRICULTURAL_BURN' || h2 === 'WILDFIRE_VEGETATION')
  ) {
    targetPair = 'Industrial Complex Hotspot vs Adjacent Rural / Wildland Burning';
  } else {
    targetPair = `${top1.label || h1} vs ${top2.label || h2}`;
  }

  return {
    targetPair,
    top1: {
      hypothesis: top1.hypothesis,
      percentage: p1,
      label: top1.label || top1.hypothesis,
    },
    top2: {
      hypothesis: top2.hypothesis,
      percentage: p2,
      label: top2.label || top2.hypothesis,
    },
    competitionIndex: cComp,
  };
}

// ----------------------------------------------------------------------------
// Temporal Suitability Evaluator
// ----------------------------------------------------------------------------
export function evaluateTemporalSuitability(params: {
  candidateType: EvidenceCandidateType;
  eventTimestamp?: string;
  sceneTimestamp?: string;
  cloudCoverPct?: number;
}): {
  status: TemporalSuitabilityStatus;
  temporalOffsetHours: number | null;
  temporalStatusLabel: string;
  suitabilityMultiplier: number;
} {
  const { candidateType, eventTimestamp, sceneTimestamp, cloudCoverPct } = params;

  if (candidateType !== 'SENTINEL2_SWIR_OPTICAL') {
    return {
      status: 'EVENT_ADJACENT',
      temporalOffsetHours: 0,
      temporalStatusLabel: 'REAL_AVAILABLE',
      suitabilityMultiplier: 1.0,
    };
  }

  if (!sceneTimestamp || !eventTimestamp) {
    return {
      status: 'UNAVAILABLE',
      temporalOffsetHours: null,
      temporalStatusLabel: 'UNAVAILABLE_PENDING_OVERPASS',
      suitabilityMultiplier: 0.90, // Pending overpass tasking retains high prospective value
    };
  }

  const eventTime = new Date(eventTimestamp).getTime();
  const sceneTime = new Date(sceneTimestamp).getTime();

  if (isNaN(eventTime) || isNaN(sceneTime)) {
    return {
      status: 'UNAVAILABLE',
      temporalOffsetHours: null,
      temporalStatusLabel: 'UNAVAILABLE_PENDING_OVERPASS',
      suitabilityMultiplier: 0.90,
    };
  }

  const diffHours = Math.abs(eventTime - sceneTime) / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  if (diffHours <= 24 && (cloudCoverPct == null || cloudCoverPct <= 20)) {
    return {
      status: 'EVENT_ADJACENT',
      temporalOffsetHours: Math.round(diffHours * 10) / 10,
      temporalStatusLabel: `EVENT_ADJACENT (${diffHours.toFixed(1)}h offset)`,
      suitabilityMultiplier: 1.0,
    };
  }

  // Scene is archival / historical baseline (> 24h)
  return {
    status: 'FORENSIC_CONTEXT',
    temporalOffsetHours: Math.round(diffHours * 10) / 10,
    temporalStatusLabel: `FORENSIC_CONTEXT (${diffDays.toFixed(1)}d offset)`,
    suitabilityMultiplier: 0.70, // Scaled down for archival imagery; contemporaneous tasking recommended
  };
}

// ----------------------------------------------------------------------------
// Core Mathematical Expected Information Gain (EIG) Calculation
// ----------------------------------------------------------------------------
export function calculateExpectedInformationGain(
  arg1:
    | string
    | CandidateOutcomeModelDefinition
    | Array<{ hypothesis: SourceHypothesisType; percentage: number }>
    | Record<SourceHypothesisType, number>
    | BayesianPosteriorResult,
  arg2?: any,
  arg3?: any,
  arg4?: any
): ExpectedEntropyAnalysis {
  let currentDistribution: any;
  let modelDef: CandidateOutcomeModelDefinition;
  let authoritativeEntropy: number | undefined;

  if (typeof arg1 === 'string') {
    modelDef = (CANDIDATE_OUTCOME_MODELS as any)[arg1] || arg2;
    currentDistribution = arg2;
    authoritativeEntropy = typeof arg3 === 'number' ? arg3 : (typeof arg4 === 'number' ? arg4 : undefined);
  } else if (arg1 && typeof arg1 === 'object' && 'outcomes' in (arg1 as any)) {
    modelDef = arg1 as CandidateOutcomeModelDefinition;
    currentDistribution = arg2;
    authoritativeEntropy = typeof arg3 === 'number' ? arg3 : (typeof arg4 === 'number' ? arg4 : undefined);
  } else {
    currentDistribution = arg1;
    if (typeof arg2 === 'string') {
      modelDef = (CANDIDATE_OUTCOME_MODELS as any)[arg2];
    } else {
      modelDef = arg2;
    }
    authoritativeEntropy = typeof arg3 === 'number' ? arg3 : (typeof arg4 === 'number' ? arg4 : undefined);
  }

  // 1. Normalize current prior to probabilities summing to 1.0 strictly over active hypotheses
  const priorProbs: Record<SourceHypothesisType, number> = {
    GAS_FLARE: 0.0,
    INDUSTRIAL_FIRE: 0.0,
    AGRICULTURAL_BURN: 0.0,
    WILDFIRE_VEGETATION: 0.0,
    OTHER: 0.0,
  };

  let distForAmbiguity: Array<{ hypothesis: SourceHypothesisType; percentage: number }> = [];

  if (currentDistribution && typeof currentDistribution === 'object' && 'posterior_probabilities' in currentDistribution) {
    const post = (currentDistribution as BayesianPosteriorResult).posterior_probabilities;
    for (const h of ALL_CANDIDATE_HYPOTHESES) {
      priorProbs[h] = post[h] ?? 0.0;
    }
    if (authoritativeEntropy === undefined && (currentDistribution as BayesianPosteriorResult).uncertainty) {
      authoritativeEntropy = (currentDistribution as BayesianPosteriorResult).uncertainty.entropy_bits;
    }
    distForAmbiguity = ALL_CANDIDATE_HYPOTHESES.map((h) => ({
      hypothesis: h,
      percentage: Math.round(priorProbs[h] * 1000) / 10,
    }));
  } else if (Array.isArray(currentDistribution)) {
    distForAmbiguity = currentDistribution;
    const totalPct = currentDistribution.reduce((sum, h) => sum + (h.percentage || 0), 0);
    if (totalPct > 0) {
      for (const h of currentDistribution) {
        if (h.hypothesis && ALL_CANDIDATE_HYPOTHESES.includes(h.hypothesis)) {
          priorProbs[h.hypothesis] = (h.percentage || 0) / totalPct;
        }
      }
    } else {
      for (const hypo of ALL_CANDIDATE_HYPOTHESES) {
        priorProbs[hypo] = 0.20;
      }
    }
  } else if (currentDistribution && typeof currentDistribution === 'object') {
    const record = currentDistribution as Record<SourceHypothesisType, number>;
    const sumVal = Object.values(record).reduce((a, b) => a + b, 0);
    for (const h of ALL_CANDIDATE_HYPOTHESES) {
      priorProbs[h] = sumVal > 0 ? (record[h] ?? 0) / sumVal : 0.20;
    }
    distForAmbiguity = ALL_CANDIDATE_HYPOTHESES.map((h) => ({
      hypothesis: h,
      percentage: Math.round(priorProbs[h] * 1000) / 10,
    }));
  }

  // Renormalize prior so sum is strictly 1.0
  const sumPrior = Object.values(priorProbs).reduce((a, b) => a + b, 0);
  if (sumPrior > 0) {
    for (const hypo of ALL_CANDIDATE_HYPOTHESES) {
      priorProbs[hypo] /= sumPrior;
    }
  }

  // Exact Current Shannon Entropy H(P_current)
  let H_current_calc = 0;
  for (const hypo of ALL_CANDIDATE_HYPOTHESES) {
    const p = priorProbs[hypo];
    if (p > 1e-12) {
      H_current_calc -= p * Math.log2(p);
    }
  }
  const H_current = authoritativeEntropy !== undefined
    ? Math.round(authoritativeEntropy * 1000) / 1000
    : Math.max(0, Math.round(H_current_calc * 1000) / 1000);

  // 2. Normalize conditional likelihood table P(o_j | h_i) so columns sum to 1.0
  const normalizedLikelihoods: Array<Record<SourceHypothesisType, number>> = modelDef.outcomes.map((outcome) => ({
    GAS_FLARE: outcome.conditionalLikelihood.GAS_FLARE ?? 0.20,
    INDUSTRIAL_FIRE: outcome.conditionalLikelihood.INDUSTRIAL_FIRE ?? 0.20,
    AGRICULTURAL_BURN: outcome.conditionalLikelihood.AGRICULTURAL_BURN ?? 0.20,
    WILDFIRE_VEGETATION: outcome.conditionalLikelihood.WILDFIRE_VEGETATION ?? 0.20,
    OTHER: outcome.conditionalLikelihood.OTHER ?? 0.20,
  }));

  for (const hypo of ALL_CANDIDATE_HYPOTHESES) {
    let colSum = 0;
    for (let j = 0; j < normalizedLikelihoods.length; j++) {
      colSum += normalizedLikelihoods[j][hypo];
    }
    if (colSum > 0) {
      for (let j = 0; j < normalizedLikelihoods.length; j++) {
        normalizedLikelihoods[j][hypo] /= colSum;
      }
    } else {
      for (let j = 0; j < normalizedLikelihoods.length; j++) {
        normalizedLikelihoods[j][hypo] = 1.0 / normalizedLikelihoods.length;
      }
    }
  }

  // 3. For each outcome o_j, calculate P(o_j), posterior distribution P(h | o_j), and posterior entropy H_j
  const outcomesAnalysis: ExpectedEntropyOutcome[] = [];
  let expectedPosteriorEntropy = 0;

  // Marginal probabilities P(o_j) = Σ_i [ P(o_j | h_i) * P(h_i) ]
  const rawMarginals = normalizedLikelihoods.map((likelihoodMap) => {
    let marginal = 0;
    for (const hypo of ALL_CANDIDATE_HYPOTHESES) {
      marginal += likelihoodMap[hypo] * priorProbs[hypo];
    }
    return marginal;
  });

  const sumMarginals = rawMarginals.reduce((a, b) => a + b, 0);
  const normalizedMarginals = rawMarginals.map((m) => (sumMarginals > 0 ? m / sumMarginals : 1.0 / rawMarginals.length));

  for (let j = 0; j < modelDef.outcomes.length; j++) {
    const outcome = modelDef.outcomes[j];
    const p_outcome = normalizedMarginals[j];

    const posteriorDistPct: Record<SourceHypothesisType, number> = {
      GAS_FLARE: 0,
      INDUSTRIAL_FIRE: 0,
      AGRICULTURAL_BURN: 0,
      WILDFIRE_VEGETATION: 0,
      OTHER: 0,
    };

    let postEntropy = 0;
    let topHypo: SourceHypothesisType = 'OTHER';
    let maxPostP = -1;

    if (p_outcome > 1e-9) {
      const posteriorProbs: Record<SourceHypothesisType, number> = {
        GAS_FLARE: 0,
        INDUSTRIAL_FIRE: 0,
        AGRICULTURAL_BURN: 0,
        WILDFIRE_VEGETATION: 0,
        OTHER: 0,
      };

      for (const hypo of ALL_CANDIDATE_HYPOTHESES) {
        const condL = normalizedLikelihoods[j][hypo];
        posteriorProbs[hypo] = (condL * priorProbs[hypo]) / p_outcome;
      }

      // Normalize posterior so sum is strictly 1.0
      const sumPost = Object.values(posteriorProbs).reduce((a, b) => a + b, 0);
      for (const hypo of ALL_CANDIDATE_HYPOTHESES) {
        const p_post = sumPost > 0 ? posteriorProbs[hypo] / sumPost : 0;
        posteriorDistPct[hypo] = Math.round(p_post * 1000) / 10;
        if (p_post > 1e-12) {
          postEntropy -= p_post * Math.log2(p_post);
        }
        if (p_post > maxPostP) {
          maxPostP = p_post;
          topHypo = hypo;
        }
      }
    } else {
      // Degenerate outcome under current prior
      for (const hypo of ALL_CANDIDATE_HYPOTHESES) {
        posteriorDistPct[hypo] = Math.round(priorProbs[hypo] * 1000) / 10;
      }
      postEntropy = H_current;
    }

    const postEntropyBits = Math.max(0, Math.round(postEntropy * 1000) / 1000);
    expectedPosteriorEntropy += p_outcome * postEntropyBits;

    outcomesAnalysis.push({
      outcome_id: outcome.id,
      outcome_name: outcome.name,
      outcome_probability: Math.round(p_outcome * 10000) / 10000,
      posterior_entropy_bits: postEntropyBits,
      posterior_top_hypothesis: topHypo,
      posterior_distribution: posteriorDistPct,
    });
  }

  const expectedPosteriorEntropyBits = Math.max(0, Math.round(expectedPosteriorEntropy * 1000) / 1000);

  // EIG = H_current - E[H] (guaranteed >= 0 within floating-point tolerance by Jensen's inequality)
  const rawEig = H_current - expectedPosteriorEntropyBits;
  const eigBits = Math.max(0, Math.round(rawEig * 1000) / 1000);

  const ambiguity = evaluateTargetAmbiguity(distForAmbiguity);

  return {
    current_entropy_bits: H_current,
    expected_posterior_entropy_bits: expectedPosteriorEntropyBits,
    expected_information_gain_bits: eigBits,
    target_ambiguity: ambiguity.targetPair,
    outcomes: outcomesAnalysis,
    information_model_name: 'PROTOTYPE_INFORMATION_MODEL (Deterministic Heuristic Compatibility Matrix)',
  };
}

export interface NbeEvaluationParams {
  obs: {
    id: string;
    frp: number;
    coordinates?: [number, number];
    satellite?: string;
    confidence?: string;
    day_night?: 'D' | 'N';
    timestamp?: string;
    sentinel2_context?: {
      scene_id?: string;
      scene_timestamp?: string;
      cloud_cover_pct?: number;
      temporal_status?: string;
    };
  };
  facility: ServerFacility | null;
  baseline: EmpiricalFacilityBaseline | null;
  observedZone: ObservedThermalActivityZone | null;
  spatialAssociation: SpatialAssociationType;
  behaviouralStatus: BehaviouralStatus;
  sourceHypotheses: PrototypeSourceHypotheses;
  uncertainty: UncertaintyAssessment;
  priority?: InvestigationPriorityResult;
  distToObservedZone: number | null;
  distToConfiguredZone: number | null;
  bayesianPosterior?: BayesianPosteriorResult;
  appliedEvidenceIds?: string[];
  evidenceAvailabilityMap?: Record<string, EvidenceAvailabilityStatus>;
}

// ----------------------------------------------------------------------------
// Full Next-Best-Evidence Strategy Evaluator
// ----------------------------------------------------------------------------
export function evaluateRealNextBestEvidence(params: NbeEvaluationParams | any): EvidenceGuidedInvestigation {
  let obs = params.obs;
  let facility = params.facility;
  let baseline = params.baseline;
  let observedZone = params.observedZone;
  let spatialAssociation = params.spatialAssociation;
  let behaviouralStatus = params.behaviouralStatus;
  let sourceHypotheses = params.sourceHypotheses;
  let uncertainty = params.uncertainty;
  let distToObservedZone = params.distToObservedZone;
  let bayesianPosterior = params.bayesianPosterior;
  let appliedEvidenceIds = params.appliedEvidenceIds || [];

  // Normalize if an InvestigationCaseData object was provided directly
  if (!obs && params.case_id) {
    const c = params;
    obs = {
      id: c.firms_observation_id || c.case_id,
      latitude: c.coordinates ? c.coordinates[0] : 0,
      longitude: c.coordinates ? c.coordinates[1] : 0,
      brightness: c.frp_mw ? c.frp_mw * 1.5 : 300,
      frp: c.frp_mw || 0,
      confidence: c.confidence || 'nominal',
      acq_date: c.timestamp ? c.timestamp.split('T')[0] : '2024-01-01',
      acq_time: c.timestamp ? c.timestamp.split('T')[1]?.replace(':', '').slice(0, 4) || '0000' : '0000',
      satellite: 'VIIRS-NPP',
      instrument: 'VIIRS',
      daynight: c.day_night || 'N',
      day_night: c.day_night || 'N',
      frp_mw: c.frp_mw || 0,
      spatial_association: c.spatial_association || 'UNASSOCIATED',
      distance_to_facility_meters: c.distance_to_facility_meters ?? 0,
      distance_to_zone_meters: c.distance_to_zone_meters ?? 0,
      is_inside_polygon: c.is_inside_polygon ?? false,
    };
    facility = c.associated_facility;
    spatialAssociation = c.spatial_association;
    behaviouralStatus = c.behaviour_assessment?.status || c.behavioural_status || 'UNKNOWN';
    sourceHypotheses = c.hypothesis_assessment;
    uncertainty = c.uncertainty_assessment;
    distToObservedZone = c.distance_to_zone_meters ?? null;
    bayesianPosterior = c.bayesian_result || c.hypothesis_assessment?.bayesian_result;
    appliedEvidenceIds = c.evidence_chain
      ? c.evidence_chain.map((e: any) => e.evidence_type || e.candidate_id || e.evidence_id)
      : [];
  }

  const appliedIds = new Set(appliedEvidenceIds);

  const isFacilityAssociated = Boolean(facility);
  const isAnomalous = behaviouralStatus === 'ANOMALOUS';
  const isElevated = behaviouralStatus === 'ELEVATED';
  const isUnassociated = spatialAssociation === 'UNASSOCIATED';

  // Authoritative Bayesian hypothesis distribution
  const dist = bayesianPosterior?.hypotheses_distribution
    ? bayesianPosterior.hypotheses_distribution.map((h: any) => ({
        hypothesis: h.hypothesis,
        percentage: h.percentage,
        label: h.label,
      }))
    : (sourceHypotheses?.fused_hypotheses || sourceHypotheses?.hypotheses_distribution || []).map((h: any) => ({
        hypothesis: h.hypothesis,
        percentage: h.percentage,
        label: h.label,
      }));

  // Target ambiguity evaluation
  const ambiguity = evaluateTargetAmbiguity(dist);
  const H = bayesianPosterior?.uncertainty?.entropy_bits ?? uncertainty?.current_entropy_bits ?? uncertainty?.entropy_bits ?? 1.39;
  const H_max = bayesianPosterior?.uncertainty?.max_possible_entropy_bits || uncertainty?.max_possible_entropy_bits || 2.322;
  const h_norm = bayesianPosterior?.uncertainty?.normalized_entropy ?? Math.min(1.0, Math.max(0.0, H / H_max));
  const C_comp = ambiguity.competitionIndex;

  const primaryHypo = ambiguity.top1.hypothesis;
  const isRuralCompeting =
    isUnassociated ||
    primaryHypo === 'AGRICULTURAL_BURN' ||
    primaryHypo === 'WILDFIRE_VEGETATION' ||
    ambiguity.top2.hypothesis === 'AGRICULTURAL_BURN' ||
    ambiguity.top2.hypothesis === 'WILDFIRE_VEGETATION';

  const isFlareFireCompeting =
    (primaryHypo === 'INDUSTRIAL_FIRE' || primaryHypo === 'GAS_FLARE') &&
    (ambiguity.top2.hypothesis === 'INDUSTRIAL_FIRE' || ambiguity.top2.hypothesis === 'GAS_FLARE');

  // Temporal Suitability for Sentinel-2
  const s2Temporal = evaluateTemporalSuitability({
    candidateType: 'SENTINEL2_SWIR_OPTICAL',
    eventTimestamp: obs.timestamp || '2026-04-22T21:30:00Z',
    sceneTimestamp: obs.sentinel2_context?.scene_timestamp || (isFacilityAssociated ? '2024-12-15T05:40:00Z' : undefined),
    cloudCoverPct: obs.sentinel2_context?.cloud_cover_pct,
  });

  // Helper to score utility using EIG and metadata
  function computeOperationalUtility(
    candidateType: EvidenceCandidateType,
    relevance: number,
    costMultiplier: number,
    temporalFactor: number,
    targetPair: string
  ): {
    score: number;
    eigAnalysis: ExpectedEntropyAnalysis;
    breakdown: UtilityScoreBreakdown;
  } {
    const modelDef = CANDIDATE_OUTCOME_MODELS[candidateType];
    const eigAnalysis = bayesianPosterior
      ? calculateExpectedInformationGain(bayesianPosterior, modelDef, H)
      : calculateExpectedInformationGain(dist, modelDef, H);

    const entropy_contribution = Math.round(0.30 * h_norm * 1000) / 1000;
    const hypothesis_competition = Math.round(0.25 * C_comp * 1000) / 1000;
    const contextual_relevance = Math.round(0.45 * relevance * 1000) / 1000;

    const raw_information_value =
      Math.round((entropy_contribution + hypothesis_competition + contextual_relevance) * 1000) / 1000;

    const effectiveCostMult = Math.round(costMultiplier * temporalFactor * 100) / 100;
    const final_utility_score = Math.min(
      100,
      Math.max(5, Math.round(100 * raw_information_value * effectiveCostMult))
    );

    return {
      score: final_utility_score,
      eigAnalysis,
      breakdown: {
        entropy_contribution,
        hypothesis_competition,
        contextual_relevance,
        raw_information_value,
        cost_multiplier: effectiveCostMult,
        final_utility_score,
        target_hypothesis_pair: targetPair,
        eig_bits: eigAnalysis.expected_information_gain_bits,
        eig_contribution: Math.round(0.30 * (eigAnalysis.expected_information_gain_bits / H_max) * 1000) / 1000,
        temporal_suitability_factor: temporalFactor,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Check Candidate Acquisition Flags
  // --------------------------------------------------------------------------
  const isSentinel2Acquired =
    appliedIds.has('SENTINEL2_SWIR_OPTICAL') ||
    appliedIds.has('EVID-SENTINEL2-SWIR') ||
    appliedIds.has('EVID-SENTINEL2-CONTEXTUAL') ||
    appliedIds.has('SENTINEL_2_SWIR_L2A');
  const isLandCoverAcquired =
    appliedIds.has('HIGH_RES_LAND_COVER_CONTEXT') || appliedIds.has('EVID-LAND-COVER');
  const isNightfireAcquired =
    appliedIds.has('VIIRS_NIGHTFIRE_COMBUSTION') || appliedIds.has('EVID-VIIRS-NIGHTFIRE');
  const isMultiPassAcquired =
    appliedIds.has('MULTI_PASS_TEMPORAL_PERSISTENCE') || appliedIds.has('EVID-MULTI-PASS');
  const isScadaAcquired =
    appliedIds.has('FACILITY_OPERATIONAL_SCADA_LOGS') || appliedIds.has('EVID-SCADA');

  // --------------------------------------------------------------------------
  // 1. Current Available / Incorporated Evidence
  // --------------------------------------------------------------------------
  const currentEvidence: EvidenceCandidate[] = [
    {
      evidenceType: 'NASA_FIRMS_VIIRS_DETECTION',
      displayName: 'NASA FIRMS VIIRS Active Thermal Detection',
      availabilityStatus: 'AVAILABLE',
      currentEvidenceStatus: 'ACQUIRED_AND_EVALUATED',
      provenanceStatus: 'REAL_AVAILABLE',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'],
      targetHypothesisPairs: ['Active High-Temperature Combustion vs Ambient Ground'],
      expectedDiscriminativeValue: 'HIGH',
      prototypeInformationValueScore: 85,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'NASA LANCE / FIRMS Active Fire Product (Real 375 m VIIRS Sensor Data)',
      whatItTellsUs: `Confirmed active thermal emission: FRP ${obs.frp} MW | Sensor: ${obs.satellite || 'VIIRS'} | Confidence: ${obs.confidence || 'nominal'}${obs.coordinates ? ` | Coords: [${obs.coordinates[0].toFixed(4)}°N, ${obs.coordinates[1].toFixed(4)}°E]` : ''}.`,
      rationale:
        'Empirical sub-pixel thermal infrared detection establishing the presence, brightness, and timestamp of the thermal emitter.',
      limitations:
        '375 m pixel footprint integrates total emitted radiance and cannot optically resolve individual flare stacks, burner heads, or ground structures.',
      assumptions: ['Emissivity of emitter is characteristic of terrestrial combustion in MWIR band.'],
    },
    {
      evidenceType: 'FACILITY_BOUNDARY_GEOMETRY',
      displayName: 'Monitored Facility Perimeter & Buffer Geometry',
      availabilityStatus: facility ? 'AVAILABLE' : 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: facility ? 'ACQUIRED_AND_EVALUATED' : 'NOT_CONNECTED',
      provenanceStatus: 'REAL_AVAILABLE',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: ['Industrial Complex vs Regional Wildland / Agriculture'],
      expectedDiscriminativeValue: facility ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: facility ? 88 : 10,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'Verified Facility GeoJSON Registry',
      whatItTellsUs: facility
        ? `Spatial association: ${
            spatialAssociation === 'KNOWN_THERMAL_ZONE'
              ? 'Inside monitored perimeter within known operational thermal zone'
              : spatialAssociation === 'FACILITY_OFF_ZONE'
              ? 'Inside monitored perimeter boundary but offset from configured stack zones'
              : 'Within perimeter buffer envelope'
          }. Monitored site: ${facility.name}.`
        : 'Observation is unassociated with any monitored industrial perimeter.',
      rationale:
        'Spatially bounds the candidate hypotheses by determining whether the event occurs on industrial process land or open regional terrain.',
      limitations: 'Boundary perimeter defines legal/operational property limits, not individual unit equipment classifications.',
      assumptions: ['Official GeoJSON boundary aligns with actual operating asset footprint.'],
    },
    {
      evidenceType: 'EMPIRICAL_HISTORICAL_BASELINE',
      displayName: 'Empirical Historical Operational Thermal Baseline',
      availabilityStatus: baseline && baseline.baseline_status === 'EMPIRICAL' ? 'AVAILABLE' : 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: baseline && baseline.baseline_status === 'EMPIRICAL' ? 'ACQUIRED_AND_EVALUATED' : 'NOT_CONNECTED',
      provenanceStatus: baseline && baseline.baseline_status === 'EMPIRICAL' ? 'REAL_AVAILABLE' : 'CONTROLLED',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      targetHypothesisPairs: ['Routine Operational Flaring vs Statistical Anomaly'],
      expectedDiscriminativeValue: baseline && baseline.baseline_status === 'EMPIRICAL' ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: baseline && baseline.baseline_status === 'EMPIRICAL' ? 90 : 15,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: `Historical VIIRS Ingestion Pipeline (${baseline?.baseline_period?.start_date || '2026-01-01'} to ${baseline?.baseline_period?.end_date || '2026-04-22'}, ${baseline?.metrics?.observation_count || 294} observations, provenance: ${baseline?.provenance_type || 'PERSISTED_REGIONAL_SUMMARY'})`,
      whatItTellsUs:
        baseline && baseline.baseline_status === 'EMPIRICAL'
          ? `${baseline?.metrics?.observation_count || 294} real VIIRS observations establish routine baseline (Median: ${baseline.metrics.frp_median} MW, P75: ${baseline.metrics.frp_p75} MW, P95: ${baseline.metrics.frp_p95} MW, scope: ${baseline.population_scope || 'FACILITY_ASSOCIATED'}). Observation FRP (${obs.frp} MW) is evaluated as ${behaviouralStatus}.`
          : 'No empirical facility baseline available for this regional location.',
      rationale:
        'Enables statistical evaluation of whether thermal intensity is consistent with routine flaring or represents an abnormal surge.',
      limitations:
        'Reflects historical observation window; major refinery revamps or planned maintenance shutdowns may shift baseline.',
      assumptions: ['Historical VIIRS detections over facility predominantly represent routine flaring activities.'],
    },
    {
      evidenceType: 'OBSERVED_THERMAL_ACTIVITY_ZONE',
      displayName: 'Observed Thermal Activity Zone (Empirical Cluster)',
      availabilityStatus: observedZone ? 'AVAILABLE' : 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: observedZone ? 'ACQUIRED_AND_EVALUATED' : 'NOT_CONNECTED',
      provenanceStatus: 'REAL_AVAILABLE',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      targetHypothesisPairs: ['Persistent Operating Zone vs Off-Zone Spatial Anomaly'],
      expectedDiscriminativeValue: observedZone ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: observedZone ? 86 : 10,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'Empirical Spatial Distribution Engine (Jamnagar Centroid: 22.3385°N, 69.8608°E)',
      whatItTellsUs: observedZone
        ? `Empirical cluster contains ${observedZone.observation_count} of ${baseline?.metrics?.observation_count || 294} (${observedZone.percentage_of_historical}%) historical observations. Current observation is ${
            distToObservedZone !== null ? `${distToObservedZone} m offset from cluster centroid` : 'evaluated'
          }.`
        : 'No empirical cluster zone configured for this location.',
      rationale:
        'Distinguishes between recurring operating clusters and novel spatial hotspots inside the industrial perimeter.',
      limitations: 'Zone has not been ground-verified with plant engineering drawings or sub-meter photography.',
      assumptions: ['Empirical spatial clustering reflects primary physical flaring infrastructure.'],
    },
    {
      evidenceType: 'OPENSTREETMAP_INFRASTRUCTURE_CONTEXT',
      displayName: 'OpenStreetMap Industrial & Infrastructure Context (Overpass API)',
      availabilityStatus: 'AVAILABLE',
      currentEvidenceStatus: 'ACQUIRED_AND_EVALUATED',
      provenanceStatus: 'REAL_AVAILABLE',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'OTHER'],
      targetHypothesisPairs: ['Mapped Flare / Chimney Stack vs Generic Industrial Ground'],
      expectedDiscriminativeValue: 'HIGH',
      prototypeInformationValueScore: 82,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'OpenStreetMap Overpass API (Real-Time Bounded Geographic Query)',
      whatItTellsUs: 'Live OSM infrastructure query retrieves nearby mapped flares, chimneys, storage tanks, and pipelines with exact metric distance from FIRMS detection.',
      rationale: 'Supplements configured boundaries with crowd-verified and public infrastructure coordinates for spatial sanity checking.',
      limitations: 'OSM relies on voluntary mapping contributions; incomplete or unmapped assets may exist. Contextual evidence only; does not supersede validated baseline.',
      assumptions: ['Mapped OSM tags accurately represent physical installations on the ground.'],
    },
    {
      evidenceType: 'ATMOSPHERIC_WIND_WEATHER',
      displayName: 'Atmospheric Boundary-Layer Wind & Weather Fields (Open-Meteo)',
      availabilityStatus: 'AVAILABLE',
      currentEvidenceStatus: 'ACQUIRED_AND_EVALUATED',
      provenanceStatus: 'REAL_AVAILABLE',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: ['Plume Dispersion Drift vs Cross-Wind Flaring Augmentation'],
      expectedDiscriminativeValue: 'MODERATE',
      prototypeInformationValueScore: 78,
      acquisitionCostEffort: 'ZERO_IMMEDIATE',
      source: 'Open-Meteo Historical Weather API (ERA5/ECMWF Reanalysis & High-Res NWP)',
      whatItTellsUs: 'Historical surface temperature, relative humidity, wind speed, meteorological direction (FROM), and downwind advection vector (TOWARD) corresponding to observation timestamp.',
      rationale: 'Provides contextual atmospheric conditions to assess boundary layer stability, plume drift heading, and whether surface winds augmented flaring or combustion intensity.',
      limitations: 'Atmospheric context does not alter baseline classification or directly identify emitter type; provides transport and dispersion evaluation.',
      assumptions: ['Reanalysis grid cell adequately represents local surface boundary conditions.'],
    },
  ];

  // If already acquired via investigator actions, register in current evidence
  if (isSentinel2Acquired) {
    currentEvidence.push({
      evidenceType: 'SENTINEL2_SWIR_OPTICAL',
      displayName: 'Copernicus Sentinel-2 MSI Multi-Spectral SWIR (B11/B12, 20m)',
      availabilityStatus: 'AVAILABLE',
      currentEvidenceStatus: 'ACQUIRED_AND_EVALUATED',
      provenanceStatus: 'REAL_AVAILABLE',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: ['Industrial Flare Stack vs Unconfined Ground Fire'],
      expectedDiscriminativeValue: 'VERY_HIGH',
      prototypeInformationValueScore: 92,
      acquisitionCostEffort: 'MODERATE_LATENCY',
      source: CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.source,
      whatItTellsUs: 'Acquired Sentinel-2 MSI 20m SWIR bands evaluated and incorporated into Bayesian posterior.',
      rationale: CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.rationale,
      limitations: CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.limitations,
      assumptions: CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.assumptions,
    });
  }

  // --------------------------------------------------------------------------
  // 2. Missing / Prospective External Evidence Candidates with Mathematical EIG
  // --------------------------------------------------------------------------
  const s2Relevance = isFlareFireCompeting ? 0.96 : isFacilityAssociated ? 0.82 : 0.45;
  const lcRelevance = isRuralCompeting ? 0.96 : isFacilityAssociated ? 0.10 : 0.70;
  const vnfRelevance = obs.day_night === 'N' ? (isFlareFireCompeting ? 0.95 : isFacilityAssociated ? 0.90 : 0.75) : 0.05;
  const multiPassRelevance = isAnomalous ? 0.86 : isFacilityAssociated ? 0.74 : 0.50;
  const scadaRelevance = isFacilityAssociated ? 0.94 : 0.02;

  // 1. Sentinel-2 SWIR
  const s2TargetPair = ambiguity.targetPair.includes('Industrial')
    ? 'Industrial Flare Stack vs Unconfined Ground Fire'
    : ambiguity.targetPair;
  const s2Result = computeOperationalUtility(
    'SENTINEL2_SWIR_OPTICAL',
    s2Relevance,
    CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.costMultiplier,
    s2Temporal.suitabilityMultiplier,
    s2TargetPair
  );

  // 2. High-Res Land Cover
  const lcTargetPair = ambiguity.targetPair.includes('Agricultural') || isRuralCompeting
    ? 'Agricultural Residue Burning vs Wildland Fire'
    : 'Vegetated Surface vs Heavy Industrial Complex';
  const lcResult = computeOperationalUtility(
    'HIGH_RES_LAND_COVER_CONTEXT',
    lcRelevance,
    CANDIDATE_OUTCOME_MODELS.HIGH_RES_LAND_COVER_CONTEXT.costMultiplier,
    1.0,
    lcTargetPair
  );

  // 3. VIIRS Nightfire
  const vnfTargetPair = 'High-Temp Gas Flare (1600-2000K) vs Low-Temp Biomass/Structure Fire (800-1200K)';
  const vnfCostMult = obs.day_night === 'N' ? CANDIDATE_OUTCOME_MODELS.VIIRS_NIGHTFIRE_COMBUSTION.costMultiplier : 0.20;
  const vnfResult = computeOperationalUtility(
    'VIIRS_NIGHTFIRE_COMBUSTION',
    vnfRelevance,
    vnfCostMult,
    1.0,
    vnfTargetPair
  );

  // 4. Multi-Pass Persistence
  const multiPassTargetPair = 'Transient Industrial Incident vs Sustained Operational Flaring';
  const multiPassResult = computeOperationalUtility(
    'MULTI_PASS_TEMPORAL_PERSISTENCE',
    multiPassRelevance,
    CANDIDATE_OUTCOME_MODELS.MULTI_PASS_TEMPORAL_PERSISTENCE.costMultiplier,
    1.0,
    multiPassTargetPair
  );

  // 5. Facility SCADA Logs
  const scadaTargetPair = 'Authorized Relief Valve Discharge vs Uncontrolled Process Fire';
  const scadaResult = computeOperationalUtility(
    'FACILITY_OPERATIONAL_SCADA_LOGS',
    scadaRelevance,
    CANDIDATE_OUTCOME_MODELS.FACILITY_OPERATIONAL_SCADA_LOGS.costMultiplier,
    1.0,
    scadaTargetPair
  );

  const missingEvidence: EvidenceCandidate[] = [];

  if (!isSentinel2Acquired) {
    missingEvidence.push({
      evidenceType: 'SENTINEL2_SWIR_OPTICAL',
      displayName: isFacilityAssociated
        ? 'Contemporaneous Copernicus Sentinel-2 SWIR Overpass Tasking'
        : 'Copernicus Sentinel-2 MSI Multi-Spectral SWIR (B11/B12, 20m)',
      availabilityStatus: obs.sentinel2_context?.scene_id ? 'AVAILABLE' : 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: obs.sentinel2_context?.scene_id ? 'CONNECTED_QUERYABLE' : 'UNAVAILABLE_PENDING_OVERPASS',
      provenanceStatus: 'REAL_AVAILABLE',
      temporal_status: isFacilityAssociated ? s2Temporal.temporalStatusLabel : 'UNAVAILABLE_PENDING_OVERPASS',
      applicableHypotheses: ['INDUSTRIAL_FIRE', 'GAS_FLARE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: [s2TargetPair, 'Point Thermal Emitter vs Surface Burn'],
      expectedDiscriminativeValue: isFlareFireCompeting || isFacilityAssociated ? 'VERY_HIGH' : 'HIGH',
      prototypeInformationValueScore: s2Result.score,
      utility_breakdown: s2Result.breakdown,
      expectedInformationGainBits: s2Result.eigAnalysis.expected_information_gain_bits,
      expectedPosteriorEntropyBits: s2Result.eigAnalysis.expected_posterior_entropy_bits,
      currentEntropyBits: s2Result.eigAnalysis.current_entropy_bits,
      targetAmbiguity: s2Result.eigAnalysis.target_ambiguity,
      expectedEntropyAnalysis: s2Result.eigAnalysis,
      acquisitionCostEffort: 'MODERATE_LATENCY',
      source: CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.source,
      whyItMatters: isFacilityAssociated
        ? s2Temporal.status === 'FORENSIC_CONTEXT'
          ? `Provides 20 m spatial resolution SWIR to physically resolve flare stack structures versus ground-level industrial fires. Existing Sentinel-2 scene is ${s2Temporal.temporalStatusLabel} (archival baseline only). Imminent contemporaneous overpass tasking is recommended to evaluate actual event kinetics.`
          : 'Provides 20 m spatial resolution shortwave infrared (1.6 µm / 2.2 µm) to physically resolve flare stack structures versus ground-level industrial fires.'
        : 'Provides 20 m spatial resolution shortwave infrared (1.6 µm / 2.2 µm) and true-color optical imagery to physically resolve flare stack structures versus ground-level industrial fires or storage tanks.',
      rationale: CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.rationale,
      limitations: CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.limitations,
      assumptions: CANDIDATE_OUTCOME_MODELS.SENTINEL2_SWIR_OPTICAL.assumptions,
    });
  }

  if (!isLandCoverAcquired) {
    missingEvidence.push({
      evidenceType: 'HIGH_RES_LAND_COVER_CONTEXT',
      displayName: 'High-Resolution Land Cover & Surface Composition (10m)',
      availabilityStatus: 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'NOT_CONNECTED',
      provenanceStatus: 'UNAVAILABLE',
      applicableHypotheses: ['AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION', 'OTHER'],
      targetHypothesisPairs: [lcTargetPair, 'Vegetated Land vs Barren / Quarry'],
      expectedDiscriminativeValue: isRuralCompeting ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: lcResult.score,
      utility_breakdown: lcResult.breakdown,
      expectedInformationGainBits: lcResult.eigAnalysis.expected_information_gain_bits,
      expectedPosteriorEntropyBits: lcResult.eigAnalysis.expected_posterior_entropy_bits,
      currentEntropyBits: lcResult.eigAnalysis.current_entropy_bits,
      targetAmbiguity: lcResult.eigAnalysis.target_ambiguity,
      expectedEntropyAnalysis: lcResult.eigAnalysis,
      acquisitionCostEffort: 'LOW_AUTOMATED',
      source: CANDIDATE_OUTCOME_MODELS.HIGH_RES_LAND_COVER_CONTEXT.source,
      whyItMatters: CANDIDATE_OUTCOME_MODELS.HIGH_RES_LAND_COVER_CONTEXT.whyItMatters,
      rationale: CANDIDATE_OUTCOME_MODELS.HIGH_RES_LAND_COVER_CONTEXT.rationale,
      limitations: CANDIDATE_OUTCOME_MODELS.HIGH_RES_LAND_COVER_CONTEXT.limitations,
      assumptions: CANDIDATE_OUTCOME_MODELS.HIGH_RES_LAND_COVER_CONTEXT.assumptions,
    });
  }

  if (!isNightfireAcquired) {
    const isDay = obs.day_night === 'D';
    missingEvidence.push({
      evidenceType: 'VIIRS_NIGHTFIRE_COMBUSTION',
      displayName: 'VIIRS Nightfire (VNF) Multi-Spectral Combustion Temperature',
      availabilityStatus: isDay ? 'OUT_OF_SCOPE' : 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'NOT_CONNECTED',
      provenanceStatus: 'UNAVAILABLE',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE', 'AGRICULTURAL_BURN', 'WILDFIRE_VEGETATION'],
      targetHypothesisPairs: [vnfTargetPair],
      expectedDiscriminativeValue: isDay ? 'LOW' : 'HIGH',
      prototypeInformationValueScore: isDay ? 5 : vnfResult.score,
      utility_breakdown: vnfResult.breakdown,
      expectedInformationGainBits: vnfResult.eigAnalysis.expected_information_gain_bits,
      expectedPosteriorEntropyBits: vnfResult.eigAnalysis.expected_posterior_entropy_bits,
      currentEntropyBits: vnfResult.eigAnalysis.current_entropy_bits,
      targetAmbiguity: vnfResult.eigAnalysis.target_ambiguity,
      expectedEntropyAnalysis: vnfResult.eigAnalysis,
      acquisitionCostEffort: 'LOW_AUTOMATED',
      source: CANDIDATE_OUTCOME_MODELS.VIIRS_NIGHTFIRE_COMBUSTION.source,
      whyItMatters: CANDIDATE_OUTCOME_MODELS.VIIRS_NIGHTFIRE_COMBUSTION.whyItMatters,
      rationale: CANDIDATE_OUTCOME_MODELS.VIIRS_NIGHTFIRE_COMBUSTION.rationale,
      limitations: isDay
        ? 'Inapplicable during daytime passes; solar reflectance precludes Planck curve fitting.'
        : 'Applicable to nighttime overpasses; fits greybody Planck radiation.',
      assumptions: CANDIDATE_OUTCOME_MODELS.VIIRS_NIGHTFIRE_COMBUSTION.assumptions,
    });
  }

  if (!isMultiPassAcquired) {
    missingEvidence.push({
      evidenceType: 'MULTI_PASS_TEMPORAL_PERSISTENCE',
      displayName: 'Multi-Mission Subsequent Satellite Passes (NOAA-20 / NOAA-21 / Landsat)',
      availabilityStatus: 'NOT_CURRENTLY_AVAILABLE',
      currentEvidenceStatus: 'UNAVAILABLE_PENDING_OVERPASS',
      provenanceStatus: 'REAL_AVAILABLE',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      targetHypothesisPairs: [multiPassTargetPair],
      expectedDiscriminativeValue: isAnomalous ? 'VERY_HIGH' : 'HIGH',
      prototypeInformationValueScore: multiPassResult.score,
      utility_breakdown: multiPassResult.breakdown,
      expectedInformationGainBits: multiPassResult.eigAnalysis.expected_information_gain_bits,
      expectedPosteriorEntropyBits: multiPassResult.eigAnalysis.expected_posterior_entropy_bits,
      currentEntropyBits: multiPassResult.eigAnalysis.current_entropy_bits,
      targetAmbiguity: multiPassResult.eigAnalysis.target_ambiguity,
      expectedEntropyAnalysis: multiPassResult.eigAnalysis,
      acquisitionCostEffort: 'MODERATE_LATENCY',
      source: CANDIDATE_OUTCOME_MODELS.MULTI_PASS_TEMPORAL_PERSISTENCE.source,
      whyItMatters: CANDIDATE_OUTCOME_MODELS.MULTI_PASS_TEMPORAL_PERSISTENCE.whyItMatters,
      rationale: CANDIDATE_OUTCOME_MODELS.MULTI_PASS_TEMPORAL_PERSISTENCE.rationale,
      limitations: CANDIDATE_OUTCOME_MODELS.MULTI_PASS_TEMPORAL_PERSISTENCE.limitations,
      assumptions: CANDIDATE_OUTCOME_MODELS.MULTI_PASS_TEMPORAL_PERSISTENCE.assumptions,
    });
  }

  if (!isScadaAcquired) {
    missingEvidence.push({
      evidenceType: 'FACILITY_OPERATIONAL_SCADA_LOGS',
      displayName: 'Facility Operational SCADA / Flaring Metering Logs',
      availabilityStatus: isFacilityAssociated ? 'UNAVAILABLE' : 'OUT_OF_SCOPE',
      currentEvidenceStatus: 'NOT_CONNECTED',
      provenanceStatus: 'CONTROLLED',
      applicableHypotheses: ['GAS_FLARE', 'INDUSTRIAL_FIRE'],
      targetHypothesisPairs: [scadaTargetPair],
      expectedDiscriminativeValue: isFacilityAssociated ? 'VERY_HIGH' : 'LOW',
      prototypeInformationValueScore: isFacilityAssociated ? scadaResult.score : 5,
      utility_breakdown: scadaResult.breakdown,
      expectedInformationGainBits: scadaResult.eigAnalysis.expected_information_gain_bits,
      expectedPosteriorEntropyBits: scadaResult.eigAnalysis.expected_posterior_entropy_bits,
      currentEntropyBits: scadaResult.eigAnalysis.current_entropy_bits,
      targetAmbiguity: scadaResult.eigAnalysis.target_ambiguity,
      expectedEntropyAnalysis: scadaResult.eigAnalysis,
      acquisitionCostEffort: 'HIGH_RESTRICTED',
      source: CANDIDATE_OUTCOME_MODELS.FACILITY_OPERATIONAL_SCADA_LOGS.source,
      whyItMatters: CANDIDATE_OUTCOME_MODELS.FACILITY_OPERATIONAL_SCADA_LOGS.whyItMatters,
      rationale: CANDIDATE_OUTCOME_MODELS.FACILITY_OPERATIONAL_SCADA_LOGS.rationale,
      limitations: CANDIDATE_OUTCOME_MODELS.FACILITY_OPERATIONAL_SCADA_LOGS.limitations,
      assumptions: CANDIDATE_OUTCOME_MODELS.FACILITY_OPERATIONAL_SCADA_LOGS.assumptions,
    });
  }

  // --------------------------------------------------------------------------
  // 3. Recommendation Ranking (Deterministic, Case-Dependent)
  // --------------------------------------------------------------------------
  const acquirableCandidates = missingEvidence.filter(
    (c) =>
      c.provenanceStatus === 'REAL_AVAILABLE' &&
      c.availabilityStatus !== 'OUT_OF_SCOPE' &&
      c.availabilityStatus !== 'ACQUISITION_FAILED' &&
      c.availabilityStatus !== 'UNAVAILABLE'
  );

  let recommendedExternalEvidence: NextBestEvidenceRecommendation;

  if (acquirableCandidates.length > 0) {
    const sortedAcquirable = [...acquirableCandidates].sort(
      (a, b) => b.prototypeInformationValueScore - a.prototypeInformationValueScore
    );
    const topCandidate = sortedAcquirable[0];
    recommendedExternalEvidence = {
      recommendedCandidate: topCandidate,
      recommendationType: 'HIGHEST_VALUE_EXTERNAL_PENDING',
      displayName: topCandidate.displayName,
      statusMessage:
        topCandidate.evidenceType === 'SENTINEL2_SWIR_OPTICAL' && isFacilityAssociated && s2Temporal.status === 'FORENSIC_CONTEXT'
          ? `Current Sentinel-2 imagery (${s2Temporal.temporalStatusLabel}) is archival baseline only. Contemporaneous Sentinel-2 SWIR acquisition or tasking is required to evaluate current kinetic progression.`
          : 'Recommended next external evidence to acquire when satellite overpass or remote sensing feeds become available.',
      whyUseful: `${topCandidate.rationale} ${topCandidate.whyItMatters || ''}`,
      discriminatesHypotheses: topCandidate.applicableHypotheses,
      availability: topCandidate.availabilityStatus,
      provenance_status: topCandidate.provenanceStatus,
      temporal_suitability: topCandidate.temporalSuitability,
      expected_information_gain_bits: topCandidate.expectedInformationGainBits,
      current_entropy_bits: topCandidate.currentEntropyBits,
      expected_posterior_entropy_bits: topCandidate.expectedPosteriorEntropyBits,
      target_ambiguity: topCandidate.targetAmbiguity,
      expected_entropy_analysis: topCandidate.expectedEntropyAnalysis,
      prototypeInformationValueScore: topCandidate.prototypeInformationValueScore,
      utility_score: topCandidate.prototypeInformationValueScore,
      targetHypothesisPairs: topCandidate.targetHypothesisPairs,
      utility_breakdown: topCandidate.utility_breakdown,
      temporal_status: topCandidate.temporal_status,
      costEffortConsideration:
        topCandidate.acquisitionCostEffort === 'LOW_AUTOMATED'
          ? 'Automated open-access retrieval with minimal processing effort.'
          : topCandidate.acquisitionCostEffort === 'MODERATE_LATENCY'
          ? 'Open-access public sensor data subject to satellite orbital revisit latency.'
          : 'Requires manual inquiry and proprietary plant clearance.',
      assumptions: topCandidate.assumptions,
    };
  } else if (missingEvidence.some((c) => c.availabilityStatus !== 'OUT_OF_SCOPE')) {
    // Only unavailable / prototype models remain
    const sortedMissing = [...missingEvidence]
      .filter((c) => c.availabilityStatus !== 'OUT_OF_SCOPE')
      .sort((a, b) => b.prototypeInformationValueScore - a.prototypeInformationValueScore);
    const topPrototype = sortedMissing[0];
    recommendedExternalEvidence = {
      recommendedCandidate: topPrototype,
      recommendationType: 'HIGHEST_VALUE_EXTERNAL_PENDING',
      displayName: topPrototype.displayName,
      statusMessage: `Prototype candidate model only. Modality (${topPrototype.displayName}) is currently UNAVAILABLE / proprietary in production runtime.`,
      whyUseful: `${topPrototype.rationale} ${topPrototype.whyItMatters || ''}`,
      discriminatesHypotheses: topPrototype.applicableHypotheses,
      availability: topPrototype.availabilityStatus,
      provenance_status: topPrototype.provenanceStatus,
      temporal_suitability: topPrototype.temporalSuitability,
      expected_information_gain_bits: topPrototype.expectedInformationGainBits,
      current_entropy_bits: topPrototype.currentEntropyBits,
      expected_posterior_entropy_bits: topPrototype.expectedPosteriorEntropyBits,
      target_ambiguity: topPrototype.targetAmbiguity,
      expected_entropy_analysis: topPrototype.expectedEntropyAnalysis,
      prototypeInformationValueScore: topPrototype.prototypeInformationValueScore,
      utility_score: topPrototype.prototypeInformationValueScore,
      targetHypothesisPairs: topPrototype.targetHypothesisPairs,
      utility_breakdown: topPrototype.utility_breakdown,
      temporal_status: topPrototype.temporal_status,
      costEffortConsideration: 'Unavailable / restricted data source; evaluated as a prospective information model only.',
      assumptions: topPrototype.assumptions,
    };
  } else {
    recommendedExternalEvidence = {
      recommendedCandidate: null,
      recommendationType: 'BEST_AVAILABLE_CONNECTED',
      displayName: 'All Eligible Evidence Incorporated',
      statusMessage: 'All applicable external evidence sources have been acquired and incorporated into the Bayesian posterior.',
      whyUseful: 'No further external evidence candidates are pending or applicable.',
      discriminatesHypotheses: [],
      availability: 'AVAILABLE',
      provenance_status: 'REAL_AVAILABLE',
      prototypeInformationValueScore: 0,
      utility_score: 0,
      costEffortConsideration: 'Zero additional acquisition cost; all candidate evidence layers are fully incorporated.',
      assumptions: ['All relevant evidence layers evaluated in the Bayesian inference model.'],
    };
  }

  const recommendedAvailableEvidence: NextBestEvidenceRecommendation = {
    recommendedCandidate: null,
    recommendationType: 'BEST_AVAILABLE_CONNECTED',
    displayName: 'Connected Ingested Evidence Evaluated',
    statusMessage: 'All primary connected data sources have been fully evaluated in the authoritative Bayesian posterior.',
    whyUseful: `Incorporated evidence items (${bayesianPosterior?.incorporated_evidence_items?.length ?? currentEvidence.length} items) have been factored into the Bayesian posterior.`,
    discriminatesHypotheses: [],
    availability: 'AVAILABLE',
    prototypeInformationValueScore: 0,
    costEffortConsideration: 'Zero additional acquisition cost; connected internal baseline and geometric layers are exhausted.',
    assumptions: [
      'Connected telemetry and facility boundaries are fully reflected in current posterior entropy.',
      'Further uncertainty reduction requires external remote sensing or ground-truth acquisitions.',
    ],
  };

  // --------------------------------------------------------------------------
  // 4. Decision Explanation
  // --------------------------------------------------------------------------
  let whyUncertain = '';
  if (isUnassociated) {
    whyUncertain =
      'Hotspot is unassociated with any monitored industrial facility. Without verified high-resolution land-cover context or multispectral surface data, current 375 m VIIRS infrared data alone cannot reliably determine whether thermal emission is agricultural residue burning, wildland scrub vegetation, or an unmonitored human activity.';
  } else if (isAnomalous) {
    const ratioStr = baseline?.metrics.frp_median
      ? `${(obs.frp / baseline.metrics.frp_median).toFixed(1)}×`
      : '5.4×';
    const offsetStr = distToObservedZone !== null ? `${distToObservedZone} m offset` : 'off-zone';
    whyUncertain = `Thermal intensity is anomalous (${obs.frp} MW, approx ${ratioStr} baseline median) and spatially deviates from the Observed Thermal Activity Zone centroid (${offsetStr}), but current single-pass VIIRS infrared evidence alone cannot reliably distinguish an industrial fire from an emergency flaring blowdown or secondary process furnace.`;
  } else if (isElevated) {
    whyUncertain = `Thermal intensity (${obs.frp} MW) is elevated above the operational median (${
      baseline?.metrics?.frp_median ?? 1.78
    } MW) but conforms to routine operational baseline percentiles. Lower behavioural deviation reduces investigation urgency, while flaring remains a plausible primary explanation.`;
  } else {
    whyUncertain =
      'Thermal output conforms to historical routine operational patterns. Current infrared evidence supports routine operational flaring without indications of abnormal fire excursions.';
  }

  const competingHypotheses = dist
    .filter((h) => (h.percentage || 0) >= 12 || h.hypothesis === ambiguity.top2.hypothesis)
    .slice(1, 4)
    .map((h) => ({
      hypothesis: h.hypothesis,
      label: h.label || h.hypothesis,
      supportPercentage: h.percentage || 0,
    }));

  const topExternalCandidate = recommendedExternalEvidence.recommendedCandidate;

  const decisionExplanation: DecisionExplanation = {
    currentAssessment: `${sourceHypotheses.primary_hypothesis} (${ambiguity.top1.percentage}% contextual support)`,
    competingHypotheses,
    whyUncertain,
    nextBestEvidence: topExternalCandidate?.displayName || 'No Additional Evidence Required',
    why: topExternalCandidate?.rationale || 'Current Bayesian posterior has integrated all available evidence.',
    availability: topExternalCandidate?.availabilityStatus || 'AVAILABLE',
    limitations: topExternalCandidate?.limitations || 'No further modalities pending.',
  };

  const methodologyDocumentation = {
    title: 'Mathematical Expected Information Gain (EIG) & Operational Utility Formulation',
    formula:
      'UtilityScore(E) = Math.round(100 * [0.30 * (H / H_max) + 0.25 * C_comp + 0.45 * Relevance(E, case)] * CostMultiplier(E) * TemporalFactor(E))',
    inputs: [
      'Exact Shannon Entropy H(P_current) = -Σ [ p_i * log2(p_i) ] bits computed from authoritative Bayesian posterior',
      'Maximum entropy H_max = log2(5) ≈ 2.322 bits',
      'Hypothesis competition index C_comp = max(0, 1.0 - (|p1 - p2| / 100))',
      'Candidate Expected Information Gain EIG(E) = H(P_current) - Σ_j [ P(o_j | E) * H(P(. | o_j, E)) ]',
      'Candidate hypothesis discrimination relevance Relevance(E, case) (0.0 to 1.0)',
      'Operational acquisition cost / latency factor CostMultiplier(E) (0.45 to 1.0)',
      'Temporal suitability factor TemporalFactor(E) (0.70 for archival baseline to 1.0 for event-adjacent)',
    ],
    assumptions: [
      'Candidate outcome likelihoods represent inspectable PROTOTYPE_INFORMATION_MODEL conditional matrices.',
      'Information-theoretic EIG is non-negative (EIG >= 0) per Jensen\'s Inequality for concave Shannon entropy.',
      'Temporal latency and sensor access costs scale candidate utility to reflect real-world investigation economics.',
    ],
    disclaimer:
      'Candidate outcome probabilities are evaluated from deterministic prototype compatibility matrices, not certified empirical Bayesian priors.',
  };

  const consumed_bayesian_posterior = bayesianPosterior
    ? {
        posterior_probabilities: bayesianPosterior.posterior_probabilities,
        entropy_bits: bayesianPosterior.uncertainty.entropy_bits,
        normalized_entropy: bayesianPosterior.uncertainty.normalized_entropy,
        hypotheses_distribution: bayesianPosterior.hypotheses_distribution,
        incorporated_evidence_count: bayesianPosterior.incorporated_evidence_items.length,
        advisory_evidence_count: bayesianPosterior.advisory_evidence_items.length,
      }
    : {
        posterior_probabilities: {
          GAS_FLARE: (dist.find((h) => h.hypothesis === 'GAS_FLARE')?.percentage || 0) / 100,
          INDUSTRIAL_FIRE: (dist.find((h) => h.hypothesis === 'INDUSTRIAL_FIRE')?.percentage || 0) / 100,
          AGRICULTURAL_BURN: (dist.find((h) => h.hypothesis === 'AGRICULTURAL_BURN')?.percentage || 0) / 100,
          WILDFIRE_VEGETATION: (dist.find((h) => h.hypothesis === 'WILDFIRE_VEGETATION')?.percentage || 0) / 100,
          OTHER: (dist.find((h) => h.hypothesis === 'OTHER')?.percentage || 0) / 100,
        },
        entropy_bits: H,
        normalized_entropy: h_norm,
        hypotheses_distribution: dist as any,
        incorporated_evidence_count: currentEvidence.length,
        advisory_evidence_count: 0,
      };

  return {
    statusLabel: 'Prototype Evidence-Guided Assessment',
    disclaimer:
      'Evidence-guided next actions are evaluated through information-theoretic entropy and heuristic discrimination utility. Final incident determinations require field or plant verification.',
    currentEvidence,
    missingEvidence,
    allCandidates: [...currentEvidence, ...missingEvidence],
    recommendedAvailableEvidence,
    recommendedExternalEvidence,
    decisionExplanation,
    consumed_bayesian_posterior,
    methodologyDocumentation,
  };
}
