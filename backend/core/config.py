from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://briefing:briefing123@db:5432/briefing_db"
    UPLOAD_DIR:   str = "uploads"
    PREVIEW_DIR:  str = "previews"
    SECRET_KEY:   str = "dev-secret-key"
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000","http://localhost:5173"]
    PDF_DPI:      int = 150
    PDF_DPI_HIGH: int = 300
    class Config:
        env_file = ".env"

settings = Settings()
