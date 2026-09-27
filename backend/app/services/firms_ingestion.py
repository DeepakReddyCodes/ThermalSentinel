import csv
import io
import httpx
from typing import List, Tuple, Optional
from ..config import settings
from ..schemas.firms import ThermalObservation, FirmsIngestionResponse

# NASA FIRMS Open Public Real-Time Feeds (updated continuously)
PUBLIC_FEEDS = {
    "VIIRS_NOAA20_NRT": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_24h.csv",
    "VIIRS_SNPP_NRT": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_24h.csv",
    "MODIS_NRT": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_South_Asia_24h.csv",
}

def parse_firms_csv_text(csv_text: str, source_label: str) -> List[ThermalObservation]:
    """
    Parses real CSV returned by NASA FIRMS into normalized ThermalObservation instances.
    """
    reader = csv.DictReader(io.StringIO(csv_text))
    observations: List[ThermalObservation] = []
    seen_keys = set()

    for idx, row in enumerate(reader):
        try:
            lat_str = row.get("latitude")
            lon_str = row.get("longitude")
            if not lat_str or not lon_str:
                continue

            lat = float(lat_str)
            lon = float(lon_str)

            # Validation
            if lat < -90.0 or lat > 90.0 or lon < -180.0 or lon > 180.0:
                continue

            # FRP
            frp = 0.0
            if "frp" in row and row["frp"]:
                try:
                    frp = float(row["frp"])
                except ValueError:
                    frp = 0.0
            if frp < 0.0 or frp > 10000.0:
                continue

            # Brightness channels
            ti4 = float(row["bright_ti4"]) if "bright_ti4" in row and row["bright_ti4"] else None
            ti5 = float(row["bright_ti5"]) if "bright_ti5" in row and row["bright_ti5"] else None
            t31 = float(row["bright_t31"]) if "bright_t31" in row and row["bright_t31"] else None
            primary_b = float(row["brightness"]) if "brightness" in row and row["brightness"] else ti4

            b_delta = round(ti4 - ti5, 1) if ti4 is not None and ti5 is not None else None

            # Scan / Track
            scan = float(row["scan"]) if "scan" in row and row["scan"] else None
            track = float(row["track"]) if "track" in row and row["track"] else None

            # Acquisition Date and Time
            acq_date = row.get("acq_date", "2026-01-01").strip()
            acq_time_raw = row.get("acq_time", "0000").replace(":", "").strip().zfill(4)
            hour = acq_time_raw[:2]
            minute = acq_time_raw[2:4]
            iso_timestamp = f"{acq_date}T{hour}:{minute}:00Z"

            # Confidence normalization
            raw_conf = str(row.get("confidence", "nominal")).strip()
            raw_conf_lower = raw_conf.lower()
            if raw_conf_lower in ["h", "high"] or (raw_conf.isdigit() and int(raw_conf) >= 80):
                confidence = "high"
            elif raw_conf_lower in ["l", "low"] or (raw_conf.isdigit() and int(raw_conf) < 40):
                confidence = "low"
            else:
                confidence = "nominal"

            # Day/Night
            day_night = "N" if str(row.get("daynight", "D")).strip().upper() == "N" else "D"

            # Satellite & Sensor normalization
            sat_raw = str(row.get("satellite", "N20")).strip()
            sat_upper = sat_raw.upper()
            if "SNPP" in sat_upper or "SUOMI" in sat_upper:
                sat = "VIIRS-SNPP"
                sensor = "VIIRS"
            elif "N21" in sat_upper or "NOAA21" in sat_upper or "J2" in sat_upper:
                sat = "VIIRS-NOAA21"
                sensor = "VIIRS"
            elif "TERRA" in sat_upper or sat_upper in ["1", "T"]:
                sat = "MODIS-Terra"
                sensor = "MODIS"
            elif "AQUA" in sat_upper or sat_upper in ["2", "A"]:
                sat = "MODIS-Aqua"
                sensor = "MODIS"
            else:
                sat = "VIIRS-NOAA20"
                sensor = "VIIRS"

            # Deduplication
            norm_lat = round(lat, 5)
            norm_lon = round(lon, 5)
            dedupe_key = f"{norm_lat}_{norm_lon}_{iso_timestamp}_{sat}_{round(frp, 2)}"
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)

            obs_id = f"FIRMS-{acq_date.replace('-', '')}-{sat.replace('-', '')}-{idx+1}"

            observations.append(
                ThermalObservation(
                    id=obs_id,
                    latitude=norm_lat,
                    longitude=norm_lon,
                    acquisition_time=iso_timestamp,
                    satellite=sat,
                    sensor=sensor,
                    frp=round(frp, 2),
                    brightness_kelvin=round(primary_b, 1) if primary_b is not None else None,
                    brightness_ti4=round(ti4, 1) if ti4 is not None else None,
                    brightness_ti5=round(ti5, 1) if ti5 is not None else None,
                    brightness_t31=round(t31, 1) if t31 is not None else None,
                    brightness_delta=b_delta,
                    confidence=confidence,
                    raw_confidence=raw_conf,
                    day_night=day_night,
                    scan=round(scan, 2) if scan is not None else None,
                    track=round(track, 2) if track is not None else None,
                    source_type="thermal_anomaly",
                    provenance="REAL_FIRMS",
                    is_real_data=True
                )
            )
        except Exception:
            continue

    return observations


async def fetch_live_firms_data(
    source: str = "VIIRS_NOAA20_NRT",
    country: str = "IND",
    day_range: int = 1,
    bbox: Optional[Tuple[float, float, float, float]] = None
) -> FirmsIngestionResponse:
    """
    Fetches genuine real thermal anomalies from NASA FIRMS.
    If FIRMS_MAP_KEY is provided in settings, uses the REST API endpoint.
    Otherwise, gracefully falls back to NASA FIRMS real public 24-hour Near Real Time feeds.
    """
    async with httpx.AsyncClient(timeout=20.0) as client:
        # 1. Try authenticated NASA FIRMS REST API if key provided
        if settings.FIRMS_MAP_KEY and settings.FIRMS_MAP_KEY.strip() != "":
            api_key = settings.FIRMS_MAP_KEY.strip()
            if bbox:
                w, s, e, n = bbox
                url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{api_key}/{source}/{w},{s},{e},{n}/{day_range}"
            else:
                url = f"https://firms.modaps.eosdis.nasa.gov/api/country/csv/{api_key}/{source}/{country}/{day_range}"

            try:
                resp = await client.get(url)
                if resp.status_code == 200 and not resp.text.strip().startswith("Invalid API call"):
                    obs = parse_firms_csv_text(resp.text, source)
                    return FirmsIngestionResponse(
                        status="SUCCESS",
                        count=len(obs),
                        source=f"NASA FIRMS REST API ({source}, country={country})",
                        is_live_external=True,
                        data_mode="LIVE_EXTERNAL",
                        observations=obs,
                        notes="Real external observations retrieved via FIRMS_MAP_KEY."
                    )
            except Exception as e:
                pass  # Fall through to open public feed

        # 2. Use NASA FIRMS Open Real-Time Feeds (Public 24-hour South Asia / Regional CSV)
        feed_url = PUBLIC_FEEDS.get(source, PUBLIC_FEEDS["VIIRS_NOAA20_NRT"])
        try:
            resp = await client.get(feed_url)
            if resp.status_code == 200:
                obs = parse_firms_csv_text(resp.text, source)
                # Filter to bounding box if specified
                if bbox:
                    w, s, e, n = bbox
                    obs = [o for o in obs if s <= o.latitude <= n and w <= o.longitude <= e]

                return FirmsIngestionResponse(
                    status="SUCCESS",
                    count=len(obs),
                    source=f"NASA FIRMS Open NRT Feed ({source})",
                    is_live_external=True,
                    data_mode="PUBLIC_FEED_LIVE",
                    observations=obs,
                    notes="Real external observations retrieved from NASA FIRMS Open NRT Feed. Configure FIRMS_MAP_KEY for custom multi-day and global country queries."
                )
            else:
                return FirmsIngestionResponse(
                    status="ERROR",
                    count=0,
                    source=feed_url,
                    is_live_external=False,
                    data_mode="UNAVAILABLE_NO_KEY",
                    observations=[],
                    notes=f"NASA FIRMS feed returned status code {resp.status_code}."
                )
        except Exception as err:
            return FirmsIngestionResponse(
                status="ERROR",
                count=0,
                source=feed_url,
                is_live_external=False,
                data_mode="UNAVAILABLE_NO_KEY",
                observations=[],
                notes=f"Failed to fetch from NASA FIRMS: {str(err)}"
            )
