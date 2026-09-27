from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api.endpoints import router as api_router
from .database.models import init_db

app = FastAPI(
    title="ThermalSentinel Geospatial Backend",
    description="Real data ingestion and spatial association backend for industrial thermal monitoring",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()

app.include_router(api_router, prefix="/api")

@app.get("/")
def root():
    return {"message": "ThermalSentinel Backend API is running. Access /api/health or /api/firms/observations."}
