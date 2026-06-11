import uuid, shutil
from pathlib import Path
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from core.database import get_db
from core.config import settings
from domain.models import Project, Artwork, Element, BriefingAction, ActionType, ElementType
from engines.detector import detect_elements, render_page, get_pdf_info
from engines.draft_engine import generate_draft
from engines.pdf_draft_engine import generate_pdf_draft, PDF_NATIVE_TYPES

router = APIRouter()

class ProjectCreate(BaseModel):
    name: str
    sku: str
    market: str
    brand: Optional[str] = None
    component: Optional[str] = None
    created_by: str = "user"

class ActionCreate(BaseModel):
    artwork_id: uuid.UUID
    page: int = 0
    action_type: ActionType
    element_id: Optional[str] = None
    element_type: Optional[str] = None
    original_text: Optional[str] = None
    new_text: Optional[str] = None
    new_font_size: Optional[float] = None
    dx_mm: Optional[float] = None
    dy_mm: Optional[float] = None
    sel_x: Optional[float] = None
    sel_y: Optional[float] = None
    sel_w: Optional[float] = None
    sel_h: Optional[float] = None
    bold: Optional[bool] = None
    comment: Optional[str] = None
    created_by: str = "user"

class DraftRequest(BaseModel):
    artwork_id: uuid.UUID
    page: int = 0
    action_ids: Optional[list[uuid.UUID]] = None

@router.post("/projects/", status_code=201)
async def create_project(data: ProjectCreate, db: AsyncSession = Depends(get_db)):
    p = Project(**data.model_dump())
    db.add(p)
    await db.flush()
    await db.refresh(p)
    return _proj(p)

@router.get("/projects/")
async def list_projects(db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(Project).order_by(Project.created_at.desc()))
    return [_proj(p) for p in r.scalars().all()]

@router.get("/projects/{pid}")
async def get_project(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return _proj(await _404(db, Project, pid))

def _proj(p):
    return {"id": str(p.id), "name": p.name, "sku": p.sku, "market": p.market,
            "brand": p.brand, "component": p.component, "created_by": p.created_by,
            "created_at": p.created_at.isoformat()}

@router.post("/artworks/upload/", status_code=201)
async def upload_artwork(
    project_id: uuid.UUID = Form(...),
    uploaded_by: str = Form("user"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)):
    await _404(db, Project, project_id)
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(exist_ok=True)
    safe = f"{uuid.uuid4().hex}_{file.filename}"
    fpath = str(upload_dir / safe)
    with open(fpath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    info = get_pdf_info(fpath)
    first = info["pages"][0] if info["pages"] else {}
    a = Artwork(project_id=project_id, filename=file.filename, file_path=fpath,
                total_pages=info["total_pages"], page_width_pts=first.get("width_pts"),
                page_height_pts=first.get("height_pts"), uploaded_by=uploaded_by)
    db.add(a)
    await db.flush()
    await db.refresh(a)
    await _detect_save(db, a, 0)
    return _artwork(a)

@router.get("/artworks/{aid}/pages/{page}")
async def get_page(aid: uuid.UUID, page: int, dpi: int = 150, db: AsyncSession = Depends(get_db)):
    a = await _404(db, Artwork, aid)
    return render_page(a.file_path, page, dpi)

@router.get("/artworks/{aid}/elements/{page}")
async def get_elements(aid: uuid.UUID, page: int, db: AsyncSession = Depends(get_db)):
    a = await _404(db, Artwork, aid)
    r = await db.execute(select(Element).where(Element.artwork_id == aid, Element.page == page))
    elems = r.scalars().all()
    if not elems:
        await _detect_save(db, a, page)
        r = await db.execute(select(Element).where(Element.artwork_id == aid, Element.page == page))
        elems = r.scalars().all()
    return [_elem(e) for e in elems]

async def _detect_save(db, artwork, page):
    for d in detect_elements(artwork.file_path, page):
        db.add(Element(
            artwork_id=artwork.id, page=page,
            elem_type=ElementType.TEXT if d["type"] == "text" else ElementType.IMAGE,
            label=d["label"], font_name=d.get("font_name"), font_size=d.get("font_size"),
            x_pts=d["x_pts"], y_pts=d["y_pts"], w_pts=d["w_pts"], h_pts=d["h_pts"],
            x_norm=d["x_norm"], y_norm=d["y_norm"], w_norm=d["w_norm"], h_norm=d["h_norm"],
            color_rgb=d.get("color"), extra=d.get("extra"),
        ))
    await db.flush()

def _artwork(a):
    return {"id": str(a.id), "project_id": str(a.project_id), "filename": a.filename,
            "total_pages": a.total_pages, "page_width_pts": a.page_width_pts,
            "page_height_pts": a.page_height_pts, "uploaded_at": a.uploaded_at.isoformat()}

def _elem(e):
    eid = f"{e.elem_type.value}_{e.id.hex[:8]}"
    allowed = ["replace", "delete", "move", "resize", "bold"] if e.elem_type == ElementType.TEXT else ["move", "delete"]
    return {"id": str(e.id), "elem_id": eid, "type": e.elem_type.value, "label": e.label,
            "font_name": e.font_name, "font_size": e.font_size, "color": e.color_rgb,
            "x_norm": e.x_norm, "y_norm": e.y_norm, "w_norm": e.w_norm, "h_norm": e.h_norm,
            "x_pts": e.x_pts, "y_pts": e.y_pts, "w_pts": e.w_pts, "h_pts": e.h_pts,
            "page": e.page, "allowed_actions": allowed}

@router.post("/actions/", status_code=201)
async def create_action(data: ActionCreate, db: AsyncSession = Depends(get_db)):
    a = BriefingAction(**data.model_dump())
    db.add(a)
    await db.flush()
    await db.refresh(a)
    return _action(a)

@router.get("/actions/artwork/{aid}")
async def list_actions(aid: uuid.UUID, page: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    q = select(BriefingAction).where(BriefingAction.artwork_id == aid)
    if page is not None:
        q = q.where(BriefingAction.page == page)
    r = await db.execute(q.order_by(BriefingAction.created_at))
    return [_action(a) for a in r.scalars().all()]

@router.delete("/actions/{aid}")
async def delete_action(aid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    a = await _404(db, BriefingAction, aid)
    await db.delete(a)
    await db.flush()
    return {"deleted": str(aid)}

def _action(a):
    return {"id": str(a.id), "artwork_id": str(a.artwork_id), "page": a.page,
            "action_type": a.action_type.value, "status": a.status.value,
            "element_id": a.element_id, "element_type": a.element_type,
            "original_text": a.original_text, "new_text": a.new_text,
            "new_font_size": a.new_font_size, "dx_mm": a.dx_mm, "dy_mm": a.dy_mm,
            "sel_x": a.sel_x, "sel_y": a.sel_y, "sel_w": a.sel_w, "sel_h": a.sel_h,
            "bold": a.bold, "comment": a.comment, "created_at": a.created_at.isoformat()}

def _select_engine(action_dicts: list[dict]) -> str:
    """
    Use pdf_native engine when every action on the page is Delete or Replace.
    Any Move / Resize / Bold action falls back to the raster engine.
    """
    if not action_dicts:
        return "raster"
    types = {str(a.get("action_type", "")).lower() for a in action_dicts}
    return "pdf_native" if types.issubset(PDF_NATIVE_TYPES) else "raster"


@router.post("/drafts/generate/")
async def draft(data: DraftRequest, db: AsyncSession = Depends(get_db)):
    artwork = await _404(db, Artwork, data.artwork_id)
    q = select(BriefingAction).where(BriefingAction.artwork_id == data.artwork_id,
                                      BriefingAction.page == data.page)
    actions = (await db.execute(q)).scalars().all()
    if data.action_ids:
        actions = [a for a in actions if a.id in data.action_ids]
    er = await db.execute(select(Element).where(Element.artwork_id == data.artwork_id,
                                                 Element.page == data.page))
    elements    = [_elem(e)   for e in er.scalars().all()]
    action_dicts = [_action(a) for a in actions]

    engine = _select_engine(action_dicts)
    if engine == "pdf_native":
        result = generate_pdf_draft(artwork.file_path, action_dicts, data.page)
    else:
        result = generate_draft(artwork.file_path, action_dicts, elements, data.page)

    return {
        **result,
        "engine":        engine,
        "total_actions": len(action_dicts),
        "briefing":      {"filename": artwork.filename, "page": data.page + 1,
                          "actions": action_dicts},
    }

async def _404(db, model, pk):
    r = await db.execute(select(model).where(model.id == pk))
    obj = r.scalar_one_or_none()
    if not obj:
        raise HTTPException(404, f"{model.__name__} not found")
    return obj
