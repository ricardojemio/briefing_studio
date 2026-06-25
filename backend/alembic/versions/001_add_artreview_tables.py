"""Add ArtReview tables: artwork_processes, process_components, process_assignments,
   briefing_annotations, comparison_results

Revision ID: 001
Revises:
Create Date: 2026-06-25

Migration uses IF NOT EXISTS throughout so it is safe to run even if
create_tables() (Base.metadata.create_all) already created the tables on startup.

Run inside the container:
    docker-compose exec backend alembic upgrade head
"""

from typing import Union, Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS artwork_processes (
            id          UUID        NOT NULL PRIMARY KEY,
            project_name VARCHAR(255) NOT NULL,
            project_description TEXT,
            status      VARCHAR(50)  NOT NULL DEFAULT 'draft',
            is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMP    WITHOUT TIME ZONE NOT NULL,
            updated_at  TIMESTAMP    WITHOUT TIME ZONE NOT NULL,
            created_by  VARCHAR(255) NOT NULL DEFAULT 'user'
        )
    """))

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS process_components (
            id                 UUID        NOT NULL PRIMARY KEY,
            process_id         UUID        NOT NULL
                REFERENCES artwork_processes(id) ON DELETE CASCADE,
            component_code     VARCHAR(100) NOT NULL,
            sku                VARCHAR(100),
            is_new_sku         BOOLEAN      NOT NULL DEFAULT FALSE,
            pdf_path           VARCHAR(500),
            market             VARCHAR(100) NOT NULL,
            manufacturing_site VARCHAR(100)
        )
    """))

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS process_assignments (
            id             UUID        NOT NULL PRIMARY KEY,
            process_id     UUID        NOT NULL
                REFERENCES artwork_processes(id) ON DELETE CASCADE,
            role           VARCHAR(50)  NOT NULL,
            assignee_email VARCHAR(255) NOT NULL,
            assigned_at    TIMESTAMP    WITHOUT TIME ZONE NOT NULL
        )
    """))

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS briefing_annotations (
            id               UUID        NOT NULL PRIMARY KEY,
            process_id       UUID        NOT NULL
                REFERENCES artwork_processes(id) ON DELETE CASCADE,
            action_type      VARCHAR(50)  NOT NULL,
            selected_text    TEXT,
            replacement_text TEXT,
            bbox_json        JSON,
            comment          TEXT,
            created_by       VARCHAR(255) NOT NULL DEFAULT 'user',
            created_at       TIMESTAMP    WITHOUT TIME ZONE NOT NULL,
            page_num         INTEGER      NOT NULL DEFAULT 0
        )
    """))

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS comparison_results (
            id                UUID        NOT NULL PRIMARY KEY,
            process_id        UUID        NOT NULL
                REFERENCES artwork_processes(id) ON DELETE CASCADE,
            original_pdf_path VARCHAR(500) NOT NULL,
            revised_pdf_path  VARCHAR(500) NOT NULL,
            differences_json  JSON,
            created_at        TIMESTAMP   WITHOUT TIME ZONE NOT NULL,
            created_by        VARCHAR(255) NOT NULL DEFAULT 'user'
        )
    """))


def downgrade() -> None:
    op.drop_table("comparison_results")
    op.drop_table("briefing_annotations")
    op.drop_table("process_assignments")
    op.drop_table("process_components")
    op.drop_table("artwork_processes")
