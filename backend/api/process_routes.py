"""
backend/api/process_routes.py

ArtReview — artwork lifecycle process endpoints.

Routes are mounted at /api/v1/processes in main.py.
"""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from domain.models import (
    MANUFACTURING_SITES,
    MARKETS,
    AnnotationActionType,
    AssignmentRole,
    ArtworkProcess,
    BriefingAnnotation,
    ComparisonResult,
    ProcessAssignment,
    ProcessComponent,
    ProcessStatus,
)

router = APIRouter(prefix="/processes", tags=["processes"])


# ── Pydantic request bodies ──────────────────────────────────────────────────────

class ProcessCreate(BaseModel):
    project_name: str
    project_description: Optional[str] = None
    created_by: str = "user"


class ProcessStatusUpdate(BaseModel):
    status: ProcessStatus


class AssignmentCreate(BaseModel):
    role: AssignmentRole
    assignee_email: str


# ── Serialisers ──────────────────────────────────────────────────────────────────

def _proc(p: ArtworkProcess) -> dict:
    return {
        "id":                  str(p.id),
        "project_name":        p.project_name,
        "project_description": p.project_description,
        "status":              p.status.value,
        "is_active":           p.is_active,
        "created_by":          p.created_by,
        "created_at":          p.created_at.isoformat(),
        "updated_at":          p.updated_at.isoformat(),
    }


def _comp(c: ProcessComponent) -> dict:
    return {
        "id":                 str(c.id),
        "process_id":         str(c.process_id),
        "component_code":     c.component_code,
        "sku":                c.sku,
        "is_new_sku":         c.is_new_sku,
        "pdf_path":           c.pdf_path,
        "market":             c.market,
        "manufacturing_site": c.manufacturing_site,
    }


def _assign(a: ProcessAssignment) -> dict:
    return {
        "id":             str(a.id),
        "process_id":     str(a.process_id),
        "role":           a.role.value,
        "assignee_email": a.assignee_email,
        "assigned_at":    a.assigned_at.isoformat(),
    }


async def _get_or_404(db: AsyncSession, model, pk: uuid.UUID):
    r = await db.execute(select(model).where(model.id == pk))
    obj = r.scalar_one_or_none()
    if not obj:
        raise HTTPException(404, f"{model.__name__} not found")
    return obj


# ── Reference data  (registered BEFORE /{pid} to avoid path-param capture) ──────

@router.get("/reference/markets")
async def list_markets():
    return MARKETS


@router.get("/reference/sites")
async def list_sites():
    return MANUFACTURING_SITES


# ── Process CRUD ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_processes(db: AsyncSession = Depends(get_db)):
    r = await db.execute(
        select(ArtworkProcess)
        .where(ArtworkProcess.is_active == True)          # noqa: E712
        .order_by(ArtworkProcess.created_at.desc())
    )
    processes = r.scalars().all()

    result = []
    for p in processes:
        comps = (await db.execute(
            select(ProcessComponent).where(ProcessComponent.process_id == p.id)
        )).scalars().all()
        assigns = (await db.execute(
            select(ProcessAssignment).where(ProcessAssignment.process_id == p.id)
        )).scalars().all()
        d = _proc(p)
        d["components"]  = [_comp(c) for c in comps]
        d["assignments"] = [_assign(a) for a in assigns]
        result.append(d)
    return result


@router.post("/", status_code=201)
async def create_process(data: ProcessCreate, db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    p = ArtworkProcess(
        project_name=data.project_name,
        project_description=data.project_description,
        created_by=data.created_by,
        created_at=now,
        updated_at=now,
    )
    db.add(p)
    await db.flush()
    await db.refresh(p)
    return _proc(p)


@router.get("/{pid}")
async def get_process(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    p = await _get_or_404(db, ArtworkProcess, pid)
    comps   = (await db.execute(select(ProcessComponent).where(ProcessComponent.process_id == pid))).scalars().all()
    assigns = (await db.execute(select(ProcessAssignment).where(ProcessAssignment.process_id == pid))).scalars().all()
    d = _proc(p)
    d["components"]  = [_comp(c) for c in comps]
    d["assignments"] = [_assign(a) for a in assigns]
    return d


@router.patch("/{pid}/status")
async def update_status(
    pid: uuid.UUID,
    data: ProcessStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    p = await _get_or_404(db, ArtworkProcess, pid)
    p.status     = data.status
    p.updated_at = datetime.utcnow()
    await db.flush()
    return _proc(p)


@router.delete("/{pid}")
async def delete_process(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    p = await _get_or_404(db, ArtworkProcess, pid)
    p.is_active  = False
    p.updated_at = datetime.utcnow()
    await db.flush()
    return {"deleted": str(pid)}


# ── Components ───────────────────────────────────────────────────────────────────

@router.get("/{pid}/components")
async def list_components(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await _get_or_404(db, ArtworkProcess, pid)
    r = await db.execute(select(ProcessComponent).where(ProcessComponent.process_id == pid))
    return [_comp(c) for c in r.scalars().all()]


@router.post("/{pid}/components", status_code=201)
async def add_component(
    pid: uuid.UUID,
    component_code: str = Form(...),
    sku: Optional[str] = Form(None),
    is_new_sku: bool = Form(False),
    market: str = Form(...),
    manufacturing_site: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, ArtworkProcess, pid)

    pdf_path: Optional[str] = None
    if file and file.filename:
        upload_dir = Path(settings.UPLOAD_DIR)
        upload_dir.mkdir(exist_ok=True)
        safe_name = f"{uuid.uuid4().hex}_{file.filename}"
        dest = upload_dir / safe_name
        with dest.open("wb") as fh:
            shutil.copyfileobj(file.file, fh)
        pdf_path = str(dest)

    c = ProcessComponent(
        process_id=pid,
        component_code=component_code,
        sku=sku or None,
        is_new_sku=is_new_sku,
        pdf_path=pdf_path,
        market=market,
        manufacturing_site=manufacturing_site or None,
    )
    db.add(c)
    await db.flush()
    await db.refresh(c)
    return _comp(c)


# ── Assignments ──────────────────────────────────────────────────────────────────

@router.get("/{pid}/assignments")
async def list_assignments(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await _get_or_404(db, ArtworkProcess, pid)
    r = await db.execute(select(ProcessAssignment).where(ProcessAssignment.process_id == pid))
    return [_assign(a) for a in r.scalars().all()]


@router.post("/{pid}/assignments", status_code=201)
async def add_assignment(
    pid: uuid.UUID,
    data: AssignmentCreate,
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, ArtworkProcess, pid)
    a = ProcessAssignment(
        process_id=pid,
        role=data.role,
        assignee_email=data.assignee_email,
        assigned_at=datetime.utcnow(),
    )
    db.add(a)
    await db.flush()
    await db.refresh(a)
    return _assign(a)
