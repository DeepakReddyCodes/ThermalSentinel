// ============================================================================
// ThermalSentinel — Operational Geographic Scope Configuration (Day 2A.2)
//
// Establishes the production operational domain as India (countryCode: "IN").
// Enforces clear separation between:
//   1. India Production Operational Corpus (facilities, industrial flares, regional fires)
//   2. Non-India Research / Reference Corpus (e.g. US wildfire perimeters, benchmark models)
//
// Geographic Boundary Note:
//   Uses a labeled coarse development filter [6.0°N to 37.5°N, 68.0°E to 98.0°E].
//   Authoritative sovereign India polygon dataset is flagged as required for
//   fine-grained border clipping before strict border-level filtering is enabled.
// ============================================================================

import {
  OperationalScopeConfig,
  OperationalScopeEvaluationResult,
  ObservationProvenance,
} from './types.js';

/**
 * Production Operational Scope Configuration
 */
export const PRODUCTION_OPERATIONAL_SCOPE: OperationalScopeConfig = {
  country_code: 'IN',
  country_name: 'India',
  enabled: true,
  coarse_geographic_bounds: {
    min_lat: 6.0,
    max_lat: 37.5,
    min_lon: 68.0,
    max_lon: 98.0,
    filter_label: 'COARSE_DEVELOPMENT_FILTER',
  },
  authoritative_boundary_available: false,
};

/**
 * Evaluates whether a geographic coordinate falls within the active operational domain.
 * Non-Indian observations are marked OUT_OF_SCOPE or RESEARCH_REFERENCE_ONLY without
 * being silently discarded or falsely interpreted as negative thermal events.
 */
export function evaluateOperationalScope(
  latitude: number,
  longitude: number,
  provenance: ObservationProvenance = 'REAL_FIRMS',
  config: OperationalScopeConfig = PRODUCTION_OPERATIONAL_SCOPE
): OperationalScopeEvaluationResult {
  // If scope filtering is disabled, everything is considered in scope
  if (!config.enabled) {
    return {
      is_in_scope: true,
      scope_status: 'IN_SCOPE',
      country_code: config.country_code,
      country_name: config.country_name,
      filter_method: 'COARSE_DEVELOPMENT_FILTER',
    };
  }

  const bounds = config.coarse_geographic_bounds;
  const isInsideEnvelope =
    latitude >= bounds.min_lat &&
    latitude <= bounds.max_lat &&
    longitude >= bounds.min_lon &&
    longitude <= bounds.max_lon;

  if (isInsideEnvelope) {
    return {
      is_in_scope: true,
      scope_status: 'IN_SCOPE',
      country_code: config.country_code,
      country_name: config.country_name,
      filter_method: bounds.filter_label,
    };
  }

  // Non-Indian observation
  const isResearchReference = provenance === 'CONTROLLED_TEST' || provenance === 'LOCAL_BENCHMARK_CACHE';
  const scopeStatus = isResearchReference ? 'RESEARCH_REFERENCE_ONLY' : 'OUT_OF_SCOPE';

  return {
    is_in_scope: false,
    scope_status: scopeStatus,
    country_code: config.country_code,
    country_name: config.country_name,
    filter_method: bounds.filter_label,
    exclusion_reason: `Observation coordinates (${latitude.toFixed(4)}°N, ${longitude.toFixed(4)}°E) are outside the operational domain (${config.country_name}). Observation is preserved for ${scopeStatus}.`,
  };
}
