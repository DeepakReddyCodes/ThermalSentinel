import os
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

class Settings(BaseModel):
    FIRMS_MAP_KEY: str = os.getenv("FIRMS_MAP_KEY", "")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

settings = Settings()
