import uuid, enum
from datetime import datetime
from sqlalchemy import String, Text, Integer, Float, Boolean, ForeignKey, DateTime, Enum as SAEnum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base

# ── ArtReview constants ──────────────────────────────────────────────────────────

MARKETS = [
    "South America", "North America", "Central America", "Caribbean",
    "Europe", "Asia", "Russia", "Oceania",
]

MANUFACTURING_SITES = [f"Manufacturing Site {i}" for i in range(1, 21)]

class ElementType(str, enum.Enum):
    TEXT="text"; IMAGE="image"; LOGO="logo"; VECTOR="vector"; BARCODE="barcode"

class ActionType(str, enum.Enum):
    REPLACE="replace"; DELETE="delete"; MOVE="move"; RESIZE="resize"; BOLD="bold"

class ActionStatus(str, enum.Enum):
    PENDING="pending"; APPLIED="applied"; REJECTED="rejected"

class Project(Base):
    __tablename__ = "projects"
    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name:       Mapped[str]       = mapped_column(String(255))
    sku:        Mapped[str]       = mapped_column(String(100), index=True)
    market:     Mapped[str]       = mapped_column(String(100))
    brand:      Mapped[str]       = mapped_column(String(100), nullable=True)
    component:  Mapped[str]       = mapped_column(String(50),  nullable=True)
    created_by: Mapped[str]       = mapped_column(String(100))
    created_at: Mapped[datetime]  = mapped_column(DateTime, default=datetime.utcnow)
    artworks: Mapped[list["Artwork"]] = relationship(back_populates="project", cascade="all, delete-orphan")

class Artwork(Base):
    __tablename__ = "artworks"
    id:              Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id:      Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    filename:        Mapped[str]       = mapped_column(String(255))
    file_path:       Mapped[str]       = mapped_column(String(500))
    total_pages:     Mapped[int]       = mapped_column(Integer, default=1)
    page_width_pts:  Mapped[float]     = mapped_column(Float, nullable=True)
    page_height_pts: Mapped[float]     = mapped_column(Float, nullable=True)
    uploaded_by:     Mapped[str]       = mapped_column(String(100))
    uploaded_at:     Mapped[datetime]  = mapped_column(DateTime, default=datetime.utcnow)
    project:  Mapped["Project"]              = relationship(back_populates="artworks")
    elements: Mapped[list["Element"]]        = relationship(back_populates="artwork", cascade="all, delete-orphan")
    actions:  Mapped[list["BriefingAction"]] = relationship(back_populates="artwork", cascade="all, delete-orphan")

class Element(Base):
    __tablename__ = "elements"
    id:         Mapped[uuid.UUID]   = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    artwork_id: Mapped[uuid.UUID]   = mapped_column(ForeignKey("artworks.id"))
    page:       Mapped[int]         = mapped_column(Integer, default=0)
    elem_type:  Mapped[ElementType] = mapped_column(SAEnum(ElementType))
    label:      Mapped[str]         = mapped_column(String(500), nullable=True)
    font_name:  Mapped[str]         = mapped_column(String(100), nullable=True)
    font_size:  Mapped[float]       = mapped_column(Float, nullable=True)
    x_pts:      Mapped[float]       = mapped_column(Float)
    y_pts:      Mapped[float]       = mapped_column(Float)
    w_pts:      Mapped[float]       = mapped_column(Float)
    h_pts:      Mapped[float]       = mapped_column(Float)
    x_norm:     Mapped[float]       = mapped_column(Float)
    y_norm:     Mapped[float]       = mapped_column(Float)
    w_norm:     Mapped[float]       = mapped_column(Float)
    h_norm:     Mapped[float]       = mapped_column(Float)
    color_rgb:  Mapped[str]         = mapped_column(String(20), nullable=True)
    extra:      Mapped[dict]        = mapped_column(JSON, nullable=True)
    artwork: Mapped["Artwork"] = relationship(back_populates="elements")

class BriefingAction(Base):
    __tablename__ = "briefing_actions"
    id:            Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    artwork_id:    Mapped[uuid.UUID]    = mapped_column(ForeignKey("artworks.id"))
    page:          Mapped[int]          = mapped_column(Integer, default=0)
    action_type:   Mapped[ActionType]   = mapped_column(SAEnum(ActionType))
    status:        Mapped[ActionStatus] = mapped_column(SAEnum(ActionStatus), default=ActionStatus.PENDING)
    element_id:    Mapped[str]          = mapped_column(String(100), nullable=True)
    element_type:  Mapped[str]          = mapped_column(String(20),  nullable=True)
    original_text: Mapped[str]          = mapped_column(Text, nullable=True)
    new_text:      Mapped[str]          = mapped_column(Text, nullable=True)
    new_font_size: Mapped[float]        = mapped_column(Float, nullable=True)
    dx_mm:         Mapped[float]        = mapped_column(Float, nullable=True)
    dy_mm:         Mapped[float]        = mapped_column(Float, nullable=True)
    sel_x:         Mapped[float]        = mapped_column(Float, nullable=True)
    sel_y:         Mapped[float]        = mapped_column(Float, nullable=True)
    sel_w:         Mapped[float]        = mapped_column(Float, nullable=True)
    sel_h:         Mapped[float]        = mapped_column(Float, nullable=True)
    bold:          Mapped[bool]         = mapped_column(Boolean, default=False)
    comment:       Mapped[str]          = mapped_column(Text, nullable=True)
    created_by:    Mapped[str]          = mapped_column(String(100), default="user")
    created_at:    Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow)
    artwork: Mapped["Artwork"] = relationship(back_populates="actions")


# ── ArtReview models ─────────────────────────────────────────────────────────────

class ProcessStatus(str, enum.Enum):
    DRAFT            = "draft"
    BRIEFING         = "briefing"
    ARTWORK_CREATION = "artwork_creation"
    APPROVAL         = "approval"
    READY            = "ready"


class AssignmentRole(str, enum.Enum):
    ARTWORK_COORDINATOR = "artwork_coordinator"
    MARKETING           = "marketing"
    REGULATORY          = "regulatory"
    MANUFACTURING_SITE  = "manufacturing_site"
    EXTERNAL_STUDIO     = "external_studio"


class AnnotationActionType(str, enum.Enum):
    DELETE  = "delete"
    REPLACE = "replace"
    MOVE    = "move"
    RESIZE  = "resize"


class ArtworkProcess(Base):
    __tablename__ = "artwork_processes"
    id:                  Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_name:        Mapped[str]          = mapped_column(String(255))
    project_description: Mapped[str]          = mapped_column(Text, nullable=True)
    status:              Mapped[ProcessStatus] = mapped_column(SAEnum(ProcessStatus, native_enum=False), default=ProcessStatus.DRAFT)
    is_active:           Mapped[bool]         = mapped_column(Boolean, default=True)
    created_at:          Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow)
    updated_at:          Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow)
    created_by:          Mapped[str]          = mapped_column(String(255), default="user")

    components:  Mapped[list["ProcessComponent"]]  = relationship(back_populates="process", cascade="all, delete-orphan")
    assignments: Mapped[list["ProcessAssignment"]] = relationship(back_populates="process", cascade="all, delete-orphan")
    annotations: Mapped[list["BriefingAnnotation"]]= relationship(back_populates="process", cascade="all, delete-orphan")
    comparisons: Mapped[list["ComparisonResult"]]  = relationship(back_populates="process", cascade="all, delete-orphan")


class ProcessComponent(Base):
    __tablename__ = "process_components"
    id:                  Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    process_id:          Mapped[uuid.UUID] = mapped_column(ForeignKey("artwork_processes.id"))
    component_code:      Mapped[str]       = mapped_column(String(100))
    sku:                 Mapped[str]       = mapped_column(String(100), nullable=True)
    is_new_sku:          Mapped[bool]      = mapped_column(Boolean, default=False)
    pdf_path:            Mapped[str]       = mapped_column(String(500), nullable=True)
    market:              Mapped[str]       = mapped_column(String(100))
    manufacturing_site:  Mapped[str]       = mapped_column(String(100), nullable=True)

    process: Mapped["ArtworkProcess"] = relationship(back_populates="components")


class ProcessAssignment(Base):
    __tablename__ = "process_assignments"
    id:             Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    process_id:     Mapped[uuid.UUID]    = mapped_column(ForeignKey("artwork_processes.id"))
    role:           Mapped[AssignmentRole]= mapped_column(SAEnum(AssignmentRole, native_enum=False))
    assignee_email: Mapped[str]          = mapped_column(String(255))
    assigned_at:    Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow)

    process: Mapped["ArtworkProcess"] = relationship(back_populates="assignments")


class BriefingAnnotation(Base):
    __tablename__ = "briefing_annotations"
    id:               Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    process_id:       Mapped[uuid.UUID]         = mapped_column(ForeignKey("artwork_processes.id"))
    action_type:      Mapped[AnnotationActionType]= mapped_column(SAEnum(AnnotationActionType, native_enum=False))
    selected_text:    Mapped[str]               = mapped_column(Text, nullable=True)
    replacement_text: Mapped[str]               = mapped_column(Text, nullable=True)
    bbox_json:        Mapped[dict]              = mapped_column(JSON, nullable=True)
    comment:          Mapped[str]               = mapped_column(Text, nullable=True)
    created_by:       Mapped[str]               = mapped_column(String(255), default="user")
    created_at:       Mapped[datetime]          = mapped_column(DateTime, default=datetime.utcnow)
    page_num:         Mapped[int]               = mapped_column(Integer, default=0)

    process: Mapped["ArtworkProcess"] = relationship(back_populates="annotations")


class ComparisonResult(Base):
    __tablename__ = "comparison_results"
    id:                 Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    process_id:         Mapped[uuid.UUID] = mapped_column(ForeignKey("artwork_processes.id"))
    original_pdf_path:  Mapped[str]       = mapped_column(String(500))
    revised_pdf_path:   Mapped[str]       = mapped_column(String(500))
    differences_json:   Mapped[dict]      = mapped_column(JSON, nullable=True)
    created_at:         Mapped[datetime]  = mapped_column(DateTime, default=datetime.utcnow)
    created_by:         Mapped[str]       = mapped_column(String(255), default="user")

    process: Mapped["ArtworkProcess"] = relationship(back_populates="comparisons")
