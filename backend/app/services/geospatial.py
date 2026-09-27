import math
from typing import List, Dict, Any, Optional
from shapely.geometry import Point, Polygon

def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Computes geodesic distance between two points in meters using the Haversine formula.
    """
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

class GeospatialAssociationEngine:
    def __init__(self, facilities: Optional[List[Dict[str, Any]]] = None):
        self.facilities = facilities or []
        self._polygons = {}
        for fac in self.facilities:
            fac_id = fac.get("id")
            raw_poly = fac.get("polygon", [])
            if fac_id and len(raw_poly) >= 3:
                # Shapely polygon expects (lon, lat) coordinates
                poly_coords = [(pt[1], pt[0]) for pt in raw_poly]
                self._polygons[fac_id] = Polygon(poly_coords)

    def associate_observation(self, lat: float, lon: float) -> Dict[str, Any]:
        """
        Associates a thermal observation point with registered industrial facility polygons & buffers.
        Returns explicit, real spatial relationships.
        """
        point_geom = Point(lon, lat)
        closest_facility = None
        min_distance_meters = float("inf")
        is_inside_boundary = False
        matched_zone = None

        for fac in self.facilities:
            fac_id = fac.get("id")
            center = fac.get("center", [0, 0])
            dist_to_center = haversine_distance_meters(lat, lon, center[0], center[1])

            # Check point-in-polygon if polygon defined
            poly = self._polygons.get(fac_id)
            inside = False
            if poly and poly.contains(point_geom):
                inside = True

            buffer_radius_meters = fac.get("buffer_radius_km", 3.0) * 1000.0

            if inside or dist_to_center <= buffer_radius_meters:
                if dist_to_center < min_distance_meters:
                    min_distance_meters = dist_to_center
                    closest_facility = fac
                    is_inside_boundary = inside

        if not closest_facility:
            return {
                "associated": False,
                "association_type": "UNASSOCIATED_REGIONAL_HOTSPOT",
                "facility_id": None,
                "facility_name": None,
                "distance_meters": None,
                "is_inside_polygon": False,
                "matched_zone": None,
                "notes": "Thermal observation is outside monitored industrial facilities."
            }

        # Check sub-zones (e.g. flare stacks, distillation units)
        known_zones = closest_facility.get("known_thermal_zones", [])
        closest_zone = None
        min_zone_dist = float("inf")
        for zone in known_zones:
            z_center = zone.get("center", [0, 0])
            z_dist = haversine_distance_meters(lat, lon, z_center[0], z_center[1])
            if z_dist < min_zone_dist:
                min_zone_dist = z_dist
                closest_zone = zone

        zone_tolerance = 400.0  # meters
        is_inside_known_zone = min_zone_dist <= zone_tolerance

        association_label = (
            "Inside Facility Boundary (Known Thermal Zone)" if is_inside_boundary and is_inside_known_zone
            else "Inside Facility Boundary (Off-Zone / Ambiguous)" if is_inside_boundary
            else f"Within Facility Buffer Zone ({round(min_distance_meters)}m from center)"
        )

        return {
            "associated": True,
            "association_type": association_label,
            "facility_id": closest_facility.get("id"),
            "facility_name": closest_facility.get("name"),
            "distance_meters": round(min_distance_meters, 1),
            "is_inside_polygon": is_inside_boundary,
            "is_inside_known_zone": is_inside_known_zone,
            "matched_zone": closest_zone.get("name") if is_inside_known_zone and closest_zone else None,
            "distance_to_zone_meters": round(min_zone_dist, 1) if closest_zone else None,
            "notes": f"Spatial match found for {closest_facility.get('name')}."
        }
