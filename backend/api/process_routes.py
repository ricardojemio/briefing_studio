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
from sqlalchemy import func, select
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
    DiffReviewStatus,
    DifferenceReview,
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


class DiffReviewBody(BaseModel):
    status: str  # "accepted" | "rejected"
    reviewer_email: str
    comment: Optional[str] = None


class ApproveBody(BaseModel):
    approved_by: str


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


# ── Comparisons ───────────────────────────────────────────────────────────────────

def _cmp(c: ComparisonResult) -> dict:
    return {
        "id":                str(c.id),
        "process_id":        str(c.process_id),
        "original_pdf_path": c.original_pdf_path,
        "revised_pdf_path":  c.revised_pdf_path,
        "created_at":        c.created_at.isoformat(),
        "created_by":        c.created_by,
        "approved_by":       c.approved_by,
        "approved_at":       c.approved_at.isoformat() if c.approved_at else None,
        "result":            c.differences_json,
    }


def _review(r: DifferenceReview) -> dict:
    return {
        "diff_id":        r.diff_id,
        "status":         r.status.value,
        "reviewer_email": r.reviewer_email,
        "comment":        r.comment,
        "reviewed_at":    r.reviewed_at.isoformat() if r.reviewed_at else None,
    }


async def _get_comparison_or_404(
    db: AsyncSession, pid: uuid.UUID, cid: uuid.UUID
) -> ComparisonResult:
    r = await db.execute(
        select(ComparisonResult).where(
            ComparisonResult.id == cid,
            ComparisonResult.process_id == pid,
        )
    )
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Comparison not found")
    return c


@router.get("/{pid}/comparisons")
async def list_comparisons(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await _get_or_404(db, ArtworkProcess, pid)
    r = await db.execute(
        select(ComparisonResult)
        .where(ComparisonResult.process_id == pid)
        .order_by(ComparisonResult.created_at.desc())
    )
    return [_cmp(c) for c in r.scalars().all()]


@router.get("/{pid}/comparisons/{cid}")
async def get_comparison(
    pid: uuid.UUID,
    cid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, ArtworkProcess, pid)
    c = await _get_comparison_or_404(db, pid, cid)
    return _cmp(c)


@router.post("/{pid}/comparison", status_code=201)
async def run_comparison(
    pid: uuid.UUID,
    file: UploadFile = File(...),
    original_pdf_path: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a revised PDF and compare it against the process's original artwork.

    `original_pdf_path` is optional: if omitted the first component with a
    pdf_path is used as the original.
    """
    from engines.pdf_comparator import compare_artworks

    proc = await _get_or_404(db, ArtworkProcess, pid)

    # Resolve original PDF
    orig_path = original_pdf_path
    if not orig_path:
        comps_r = await db.execute(
            select(ProcessComponent)
            .where(
                ProcessComponent.process_id == pid,
                ProcessComponent.pdf_path.isnot(None),
            )
        )
        first_comp = comps_r.scalars().first()
        if not first_comp:
            raise HTTPException(
                400,
                "No original PDF found for this process. "
                "Upload a component PDF first or supply original_pdf_path.",
            )
        orig_path = first_comp.pdf_path

    if not Path(orig_path).exists():
        raise HTTPException(400, f"Original PDF not found on disk: {orig_path}")

    # Save the uploaded revised PDF
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(exist_ok=True)
    rev_filename = f"{uuid.uuid4().hex}_{file.filename}"
    rev_path     = str(upload_dir / rev_filename)
    with open(rev_path, "wb") as fh:
        shutil.copyfileobj(file.file, fh)

    # Run comparison
    comparison_id = uuid.uuid4().hex[:12]
    result = compare_artworks(
        original_pdf_path=orig_path,
        revised_pdf_path=rev_path,
        dpi=settings.PDF_DPI,
        preview_dir=settings.PREVIEW_DIR,
        comparison_id=comparison_id,
    )

    # Persist result
    now = datetime.utcnow()
    c = ComparisonResult(
        process_id=pid,
        original_pdf_path=orig_path,
        revised_pdf_path=rev_path,
        differences_json=result,
        created_at=now,
        created_by=proc.created_by,
    )
    db.add(c)
    await db.flush()
    await db.refresh(c)
    return _cmp(c)


# ── Difference reviews ────────────────────────────────────────────────────────────

@router.patch("/{pid}/comparisons/{cid}/differences/{diff_id}")
async def review_difference(
    pid:     uuid.UUID,
    cid:     uuid.UUID,
    diff_id: str,
    data:    DiffReviewBody,
    db:      AsyncSession = Depends(get_db),
):
    await _get_or_404(db, ArtworkProcess, pid)
    c = await _get_comparison_or_404(db, pid, cid)

    if data.status not in ("accepted", "rejected"):
        raise HTTPException(400, "status must be 'accepted' or 'rejected'")

    all_diff_ids = {
        d["id"]
        for page in (c.differences_json or {}).get("pages", [])
        for d in page.get("differences", [])
    }
    if diff_id not in all_diff_ids:
        raise HTTPException(404, f"diff_id '{diff_id}' not found in comparison")

    r = await db.execute(
        select(DifferenceReview).where(
            DifferenceReview.comparison_id == cid,
            DifferenceReview.diff_id == diff_id,
        )
    )
    review = r.scalar_one_or_none()
    now = datetime.utcnow()

    if review:
        review.status         = DiffReviewStatus(data.status)
        review.reviewer_email = data.reviewer_email
        review.comment        = data.comment
        review.reviewed_at    = now
    else:
        review = DifferenceReview(
            comparison_id  = cid,
            diff_id        = diff_id,
            status         = DiffReviewStatus(data.status),
            reviewer_email = data.reviewer_email,
            comment        = data.comment,
            reviewed_at    = now,
        )
        db.add(review)

    await db.flush()
    await db.refresh(review)
    return _review(review)


@router.get("/{pid}/comparisons/{cid}/reviews")
async def list_diff_reviews(
    pid: uuid.UUID,
    cid: uuid.UUID,
    db:  AsyncSession = Depends(get_db),
):
    await _get_or_404(db, ArtworkProcess, pid)
    await _get_comparison_or_404(db, pid, cid)
    r = await db.execute(
        select(DifferenceReview).where(DifferenceReview.comparison_id == cid)
    )
    return [_review(rev) for rev in r.scalars().all()]


@router.get("/{pid}/comparisons/{cid}/review-summary")
async def get_review_summary(
    pid: uuid.UUID,
    cid: uuid.UUID,
    db:  AsyncSession = Depends(get_db),
):
    await _get_or_404(db, ArtworkProcess, pid)
    c = await _get_comparison_or_404(db, pid, cid)

    total = (c.differences_json or {}).get("summary", {}).get("total_differences", 0)

    rows = await db.execute(
        select(DifferenceReview.status, func.count(DifferenceReview.id).label("cnt"))
        .where(DifferenceReview.comparison_id == cid)
        .group_by(DifferenceReview.status)
    )
    counts   = {row.status: row.cnt for row in rows}
    accepted = counts.get(DiffReviewStatus.ACCEPTED, 0)
    rejected = counts.get(DiffReviewStatus.REJECTED, 0)
    pending  = max(0, total - accepted - rejected)

    return {
        "total":          total,
        "accepted":       accepted,
        "rejected":       rejected,
        "pending":        pending,
        "can_approve":    pending == 0,
        "has_rejections": rejected > 0,
    }


@router.post("/{pid}/comparisons/{cid}/approve")
async def approve_comparison(
    pid:  uuid.UUID,
    cid:  uuid.UUID,
    data: ApproveBody,
    db:   AsyncSession = Depends(get_db),
):
    await _get_or_404(db, ArtworkProcess, pid)
    c = await _get_comparison_or_404(db, pid, cid)

    total = (c.differences_json or {}).get("summary", {}).get("total_differences", 0)
    row   = await db.execute(
        select(func.count(DifferenceReview.id))
        .where(DifferenceReview.comparison_id == cid)
    )
    reviewed = row.scalar_one()
    if reviewed < total:
        raise HTTPException(
            400,
            f"Cannot approve: {total - reviewed} difference(s) still pending review",
        )

    now           = datetime.utcnow()
    c.approved_by = data.approved_by
    c.approved_at = now
    await db.flush()

    return {
        "approved_by": c.approved_by,
        "approved_at": c.approved_at.isoformat(),
    }
