from pydantic import BaseModel, Field
from typing import Optional, List, Literal

class RawFirmsRecord(BaseModel):
    latitude: float
    longitude: float
    brightness: Optional[float] = None
    bright_t31: Optional[float] = None
    frp: Optional[float] = None
    acq_date: str
    acq_time: str
    satellite: str
    instrument: Optional[str] = None
    confidence: str
    version: Optional[str] = None
    daynight: str

class ThermalObservation(BaseModel):
    id: str
    latitude: float
    longitude: float
    acquisition_time: str  # ISO-8601 UTC
    satellite: str
    sensor: str
    frp: float  # Fire Radiative Power in MW
    brightness_kelvin: Optional[float] = None
    brightness_ti4: Optional[float] = None
    brightness_ti5: Optional[float] = None
    brightness_t31: Optional[float] = None
    brightness_delta: Optional[float] = None
    confidence: Literal["low", "nominal", "high"]
    raw_confidence: Optional[str] = None
    day_night: Literal["D", "N"]
    scan: Optional[float] = None
    track: Optional[float] = None
    source_type: str = "thermal_anomaly"
    provenance: str = "REAL_FIRMS"
    is_real_data: bool = True
    raw_record: Optional[str] = None
    spatial_association: Optional[dict] = None

class FirmsIngestionResponse(BaseModel):
    status: str
    count: int
    source: str
    is_live_external: bool
    data_mode: Literal["LIVE_EXTERNAL", "PUBLIC_FEED_LIVE", "UNAVAILABLE_NO_KEY"]
    observations: List[ThermalObservation]
    notes: Optional[str] = None
