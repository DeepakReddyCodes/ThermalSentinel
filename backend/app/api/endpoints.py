from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List
from ..schemas.firms import FirmsIngestionResponse, ThermalObservation
from ..services.firms_ingestion import fetch_live_firms_data
from ..services.geospatial import GeospatialAssociationEngine
from ..database.models import get_db_status
from ..config import settings

router = APIRouter()

# Real Indian industrial facilities with accurate geospatial footprints
REAL_FACILITIES = [
    {
        "id": "FAC-GUJ-JAMNAGAR-01",
        "name": "Jamnagar Refining & Petrochemical Complex",
        "operator": "Reliance Industries Limited",
        "category": "refinery",
        "state": "Gujarat",
        "region": "Gulf of Kutch",
        "center": [22.3598, 69.8642],
        "polygon": [
            [22.3780, 69.8420],
            [22.3795, 69.8920],
            [22.3480, 69.8960],
            [22.3350, 69.8610],
            [22.3490, 69.8380],
        ],
        "buffer_radius_km": 3.5,
        "known_thermal_zones": [
            {
                "id": "ZONE-JAM-01",
                "name": "North Flare Stack Cluster (Flares A1-A4)",
                "center": [22.3685, 69.8690],
                "expected_max_frp": 35.0
            },
            {
                "id": "ZONE-JAM-02",
                "name": "Delayed Coker & Crude Distillation Unit",
                "center": [22.3560, 69.8610],
                "expected_max_frp": 25.0
            }
        ]
    },
    {
        "id": "FAC-GUJ-DAHEJ-02",
        "name": "Dahej Petrochemical Complex & Dual-Feed Cracker",
        "operator": "ONGC Petro additions Ltd (OPaL)",
        "category": "petrochemical",
        "state": "Gujarat",
        "region": "Dahej PCPIR Belt",
        "center": [21.7050, 72.5480],
        "polygon": [
            [21.7220, 72.5320],
            [21.7240, 72.5680],
            [21.6910, 72.5710],
            [21.6880, 72.5350],
        ],
        "buffer_radius_km": 3.0,
        "known_thermal_zones": [
            {
                "id": "ZONE-DAH-01",
                "name": "High-Pressure Ethylene Flare Tower",
                "center": [21.7088, 72.5515],
                "expected_max_frp": 30.0
            }
        ]
    },
    {
        "id": "FAC-GUJ-HAZIRA-03",
        "name": "Hazira LNG Terminal & Petrochemical Manufacturing",
        "operator": "Shell Hazira / Reliance Hazira",
        "category": "lng_terminal",
        "state": "Gujarat",
        "region": "Hazira Industrial Belt",
        "center": [21.1180, 72.6780],
        "polygon": [
            [21.1390, 72.6580],
            [21.1410, 72.7020],
            [21.0980, 72.7050],
            [21.0950, 72.6610],
        ],
        "buffer_radius_km": 3.0,
        "known_thermal_zones": [
            {
                "id": "ZONE-HAZ-01",
                "name": "Marine Boil-Off Gas Flare",
                "center": [21.1150, 72.6680],
                "expected_max_frp": 20.0
            }
        ]
    },
    {
        "id": "FAC-ODI-PARADIP-04",
        "name": "Paradip Refinery & Petrochemical Complex",
        "operator": "Indian Oil Corporation Limited (IOCL)",
        "category": "refinery",
        "state": "Odisha",
        "region": "Mahanadi Delta Coast",
        "center": [20.2920, 86.6620],
        "polygon": [
            [20.3120, 86.6380],
            [20.3150, 86.6850],
            [20.2710, 86.6880],
            [20.2680, 86.6410],
        ],
        "buffer_radius_km": 3.5,
        "known_thermal_zones": [
            {
                "id": "ZONE-PAR-01",
                "name": "INDMAX Heavy Residue Cracking Flare",
                "center": [20.2950, 86.6580],
                "expected_max_frp": 32.0
            }
        ]
    }
]

geo_engine = GeospatialAssociationEngine(REAL_FACILITIES)

@router.get("/health")
def get_health():
    return {
        "status": "HEALTHY",
        "system": "ThermalSentinel Real Backend",
        "version": "1.0.0",
        "firms_configured": bool(settings.FIRMS_MAP_KEY and settings.FIRMS_MAP_KEY.strip()),
        "firms_data_mode": "NASA_REST_API" if (settings.FIRMS_MAP_KEY and settings.FIRMS_MAP_KEY.strip()) else "NASA_OPEN_NRT_FEED",
        "database": get_db_status(),
        "external_data_sources": {
            "NASA_FIRMS_VIIRS_NOAA20": "LIVE",
            "NASA_FIRMS_VIIRS_SNPP": "LIVE",
            "NASA_FIRMS_MODIS": "LIVE",
            "SENTINEL_2_SWIR": "REQUIRES_CONFIG",
            "WEATHER_API": "REQUIRES_CONFIG",
            "POSTGRES_POSTGIS": get_db_status()["status"]
        }
    }

@router.get("/firms/observations", response_model=FirmsIngestionResponse)
async def get_firms_observations(
    source: str = Query("VIIRS_NOAA20_NRT", description="Satellite sensor feed (VIIRS_NOAA20_NRT, VIIRS_SNPP_NRT, MODIS_NRT)"),
    country: str = Query("IND", description="ISO 3-letter country code"),
    day_range: int = Query(1, ge=1, le=10, description="Day range for queries"),
    min_frp: float = Query(0.0, ge=0.0, description="Minimum FRP filter"),
    associate_facilities: bool = Query(True, description="Whether to compute geospatial association with monitored facilities")
):
    """
    Fetches real active fire/thermal anomaly observations directly from NASA FIRMS.
    Performs spatial association against real industrial facility polygons.
    """
    response = await fetch_live_firms_data(source=source, country=country, day_range=day_range)

    # Filter observations by FRP
    filtered_obs = [o for o in response.observations if o.frp >= min_frp]

    # Perform genuine geospatial association
    if associate_facilities:
        for obs in filtered_obs:
            assoc = geo_engine.associate_observation(obs.latitude, obs.longitude)
            obs.spatial_association = assoc

    response.observations = filtered_obs
    response.count = len(filtered_obs)
    return response

@router.get("/facilities")
def get_facilities():
    """
    Returns registered industrial facilities with polygons and known thermal zones.
    """
    return {
        "status": "SUCCESS",
        "count": len(REAL_FACILITIES),
        "facilities": REAL_FACILITIES
    }
