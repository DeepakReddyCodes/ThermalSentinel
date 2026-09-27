from sqlalchemy import create_engine, Column, String, Float, DateTime, Boolean, JSON, Integer
from sqlalchemy.orm import declarative_base, sessionmaker
from ..config import settings

Base = declarative_base()

class ThermalObservationRecord(Base):
    __tablename__ = "thermal_observations"

    id = Column(String, primary_key=True, index=True)
    latitude = Column(Float, nullable=False, index=True)
    longitude = Column(Float, nullable=False, index=True)
    acquisition_time = Column(String, nullable=False, index=True)
    satellite = Column(String, nullable=False)
    sensor = Column(String, nullable=False)
    frp = Column(Float, nullable=False)
    brightness_kelvin = Column(Float, nullable=False)
    confidence = Column(String, nullable=False)
    day_night = Column(String, nullable=False)
    facility_id = Column(String, nullable=True, index=True)
    spatial_association = Column(JSON, nullable=True)
    is_real_data = Column(Boolean, default=True)

class FacilityRecord(Base):
    __tablename__ = "facilities"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    operator = Column(String, nullable=False)
    category = Column(String, nullable=False)
    state = Column(String, nullable=False)
    region = Column(String, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    boundary_geojson = Column(JSON, nullable=True)
    buffer_radius_km = Column(Float, default=3.0)
    known_zones = Column(JSON, nullable=True)

# Database Engine & Session Provider
db_engine = None
SessionLocal = None

def init_db():
    global db_engine, SessionLocal
    if settings.DATABASE_URL and settings.DATABASE_URL.strip() != "":
        try:
            db_engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
            SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
            Base.metadata.create_all(bind=db_engine)
            return True
        except Exception as e:
            print(f"[DB Warning] Could not connect to DATABASE_URL: {e}")
            return False
    return False

def get_db_status():
    if not settings.DATABASE_URL or settings.DATABASE_URL.strip() == "":
        return {
            "status": "UNCONFIGURED",
            "message": "DATABASE_URL is not set. Real external data is streamed in-memory directly from NASA FIRMS.",
            "postgis_enabled": False
        }
    if db_engine:
        return {
            "status": "CONNECTED",
            "message": "Connected to PostgreSQL database.",
            "postgis_enabled": True
        }
    return {
        "status": "CONNECTION_FAILED",
        "message": "DATABASE_URL is set but connection could not be established.",
        "postgis_enabled": False
    }
