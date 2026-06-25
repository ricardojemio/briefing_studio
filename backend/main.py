from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from pathlib import Path
from core.config import settings
from core.database import create_tables
from api.routes import router
from api.process_routes import router as process_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    Path(settings.UPLOAD_DIR).mkdir(exist_ok=True)
    Path(settings.PREVIEW_DIR).mkdir(exist_ok=True)
    yield

app = FastAPI(title="Briefing Studio API", version="1.0.0", lifespan=lifespan)

app.add_middleware(CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.mount("/previews", StaticFiles(directory=settings.PREVIEW_DIR), name="previews")
app.mount("/uploads",  StaticFiles(directory=settings.UPLOAD_DIR),  name="uploads")

app.include_router(router, prefix="/api/v1")
app.include_router(process_router, prefix="/api/v1")

@app.get("/health")
async def health():
    return {"status": "ok"}
