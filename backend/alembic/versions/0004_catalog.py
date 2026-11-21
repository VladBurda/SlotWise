"""Scheduling configuration and tenant-safe catalog relationships."""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE catalog_items (
        id UUID NOT NULL,
        workspace_id UUID NOT NULL,
        kind VARCHAR(12) NOT NULL,
        name VARCHAR(100) NOT NULL,
        active BOOLEAN NOT NULL,
        version INTEGER NOT NULL,
        location_id UUID,
        details JSONB NOT NULL,
        CONSTRAINT pk_catalog_items PRIMARY KEY (id),
        CONSTRAINT uq_catalog_items_workspace_id UNIQUE (workspace_id, id, kind),
        CONSTRAINT ck_catalog_items_kind CHECK (kind IN
            ('skills','staff','resources','pools','services')),
        CONSTRAINT ck_catalog_items_version CHECK (version > 0),
        CONSTRAINT fk_catalog_items_workspace_id_locations FOREIGN KEY(workspace_id,
            location_id) REFERENCES locations (workspace_id, id),
        CONSTRAINT ck_catalog_items_location_kind CHECK ((kind IN
            ('staff','resources','pools') AND location_id IS NOT NULL) OR (kind IN
            ('skills','services') AND location_id IS NULL)),
        CONSTRAINT fk_catalog_items_workspace_id_workspaces FOREIGN KEY(workspace_id)
            REFERENCES workspaces (id)
        )
    """)
    op.execute("CREATE INDEX ix_catalog_items_workspace_id ON catalog_items (workspace_id)")
    op.execute("""
        CREATE TABLE capacity_units (
        id UUID NOT NULL,
        workspace_id UUID NOT NULL,
        item_id UUID NOT NULL,
        item_kind VARCHAR(12) NOT NULL,
        number INTEGER NOT NULL,
        active BOOLEAN NOT NULL,
        CONSTRAINT pk_capacity_units PRIMARY KEY (id),
        CONSTRAINT fk_capacity_units_workspace_id_catalog_items FOREIGN
            KEY(workspace_id, item_id, item_kind) REFERENCES catalog_items
            (workspace_id, id, kind),
        CONSTRAINT uq_capacity_unit_number UNIQUE (workspace_id, item_id, number),
        CONSTRAINT uq_capacity_unit_workspace_id UNIQUE (workspace_id, id),
        CONSTRAINT ck_capacity_units_item_kind CHECK (item_kind IN
            ('staff','resources')),
        CONSTRAINT ck_capacity_units_number CHECK (number BETWEEN 1 AND 100)
        )
    """)
    op.execute("""
        CREATE TABLE catalog_links (
        workspace_id UUID NOT NULL,
        source_id UUID NOT NULL,
        target_id UUID NOT NULL,
        source_kind VARCHAR(12) NOT NULL,
        target_kind VARCHAR(12) NOT NULL,
        valid_until DATE,
        CONSTRAINT pk_catalog_links PRIMARY KEY (workspace_id, source_id, target_id),
        CONSTRAINT fk_catalog_links_source FOREIGN KEY(workspace_id, source_id,
            source_kind) REFERENCES catalog_items (workspace_id, id, kind),
        CONSTRAINT fk_catalog_links_target FOREIGN KEY(workspace_id, target_id,
            target_kind) REFERENCES catalog_items (workspace_id, id, kind),
        CONSTRAINT ck_catalog_links_link_kinds CHECK ((source_kind = 'staff' AND
            target_kind = 'skills') OR (source_kind = 'pools' AND target_kind =
            'resources') OR (source_kind = 'services' AND target_kind IN
            ('staff','skills','resources')))
        )
    """)
    op.execute("""
        CREATE TABLE service_locations (
        workspace_id UUID NOT NULL,
        service_id UUID NOT NULL,
        location_id UUID NOT NULL,
        service_kind VARCHAR(12) NOT NULL,
        CONSTRAINT pk_service_locations PRIMARY KEY (workspace_id, service_id,
            location_id),
        CONSTRAINT fk_service_locations_workspace_id_catalog_items FOREIGN
            KEY(workspace_id, service_id, service_kind) REFERENCES catalog_items
            (workspace_id, id, kind),
        CONSTRAINT fk_service_locations_workspace_id_locations FOREIGN KEY(workspace_id,
            location_id) REFERENCES locations (workspace_id, id),
        CONSTRAINT ck_service_locations_service_kind CHECK (service_kind = 'services')
        )
    """)
    op.execute("""
        CREATE TABLE service_requirements (
        workspace_id UUID NOT NULL,
        service_id UUID NOT NULL,
        position INTEGER NOT NULL,
        service_kind VARCHAR(12) NOT NULL,
        target_id UUID,
        target_kind VARCHAR(12),
        resource_type VARCHAR(50),
        quantity INTEGER NOT NULL,
        units INTEGER NOT NULL,
        CONSTRAINT pk_service_requirements PRIMARY KEY (workspace_id, service_id,
            position),
        CONSTRAINT fk_service_requirements_service FOREIGN
            KEY(workspace_id, service_id, service_kind) REFERENCES catalog_items
            (workspace_id, id, kind),
        CONSTRAINT fk_service_requirements_target FOREIGN
            KEY(workspace_id, target_id, target_kind) REFERENCES catalog_items
            (workspace_id, id, kind),
        CONSTRAINT ck_service_requirements_service_kind CHECK (service_kind =
            'services'),
        CONSTRAINT ck_service_requirements_selector CHECK ((target_id IS NOT NULL AND
            target_kind IS NOT NULL AND target_kind IN ('resources','pools') AND
            resource_type IS NULL) OR (target_id IS NULL AND target_kind IS NULL AND
            resource_type IS NOT NULL)),
        CONSTRAINT ck_service_requirements_capacity CHECK (quantity BETWEEN 1 AND 100
            AND units BETWEEN 1 AND 100),
        CONSTRAINT ck_service_requirements_specific CHECK (target_kind IS DISTINCT FROM
            'resources' OR quantity = 1)
        )
    """)


def downgrade() -> None:
    op.drop_table("service_requirements")
    op.drop_table("service_locations")
    op.drop_table("catalog_links")
    op.drop_table("capacity_units")
    op.drop_table("catalog_items")
