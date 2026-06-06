import uuid, enum
from datetime import datetime
from sqlalchemy import String, Text, Integer, Float, Boolean, ForeignKey, DateTime, Enum as SAEnum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base

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
    project:  Mapped["Project"]             = relationship(back_populates="artworks")
    elements: Mapped[list["Element"]]       = relationship(back_populates="artwork", cascade="all, delete-orphan")
    actions:  Mapped[list["BriefingAction"]]= relationship(back_populates="artwork", cascade="all, delete-orphan")

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
