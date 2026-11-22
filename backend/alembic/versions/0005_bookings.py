"""Atomic bookings, durable receipts and exclusion-protected allocations."""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public")
    op.execute("""
        CREATE TABLE appointments (
            id UUID NOT NULL,
            workspace_id UUID NOT NULL,
            service_id UUID NOT NULL,
            service_kind VARCHAR(12) NOT NULL,
            location_id UUID NOT NULL,
            created_by UUID NOT NULL,
            customer_name VARCHAR(100) NOT NULL,
            status VARCHAR(12) NOT NULL,
            version INTEGER NOT NULL,
            starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
            ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            details JSONB NOT NULL,
            CONSTRAINT pk_appointments PRIMARY KEY (id),
            CONSTRAINT uq_appointments_workspace_id UNIQUE (workspace_id, id),
            CONSTRAINT fk_appointments_workspace_id_catalog_items
                FOREIGN KEY(workspace_id, service_id, service_kind)
                REFERENCES catalog_items (workspace_id, id, kind),
            CONSTRAINT fk_appointments_workspace_id_locations
                FOREIGN KEY(workspace_id, location_id)
                REFERENCES locations (workspace_id, id),
            CONSTRAINT ck_appointments_service_kind CHECK (service_kind = 'services'),
            CONSTRAINT ck_appointments_status CHECK (status IN ('confirmed','cancelled')),
            CONSTRAINT ck_appointments_version CHECK (version > 0),
            CONSTRAINT ck_appointments_ordered CHECK (starts_at < ends_at),
            CONSTRAINT fk_appointments_workspace_id_workspaces
                FOREIGN KEY(workspace_id)
                REFERENCES workspaces (id),
            CONSTRAINT fk_appointments_created_by_users
                FOREIGN KEY(created_by)
                REFERENCES users (id)
        )
    """)
    op.execute("CREATE INDEX ix_appointments_workspace_id ON appointments (workspace_id)")
    op.execute("""
        CREATE TABLE allocations (
            workspace_id UUID NOT NULL,
            appointment_id UUID NOT NULL,
            unit_id UUID NOT NULL,
            starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
            ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT pk_allocations PRIMARY KEY (workspace_id, appointment_id, unit_id),
            CONSTRAINT fk_allocations_workspace_id_appointments
                FOREIGN KEY(workspace_id, appointment_id)
                REFERENCES appointments (workspace_id, id),
            CONSTRAINT fk_allocations_workspace_id_capacity_units
                FOREIGN KEY(workspace_id, unit_id)
                REFERENCES capacity_units (workspace_id, id),
            CONSTRAINT ck_allocations_ordered CHECK (starts_at < ends_at),
            CONSTRAINT allocations_no_overlap
                EXCLUDE USING gist (unit_id public.gist_uuid_ops WITH =
                , tstzrange(starts_at, ends_at, '[)') WITH &&)
        )
    """)
    op.execute("""
        CREATE TABLE booking_requests (
            workspace_id UUID NOT NULL,
            actor_id UUID NOT NULL,
            key UUID NOT NULL,
            digest VARCHAR(64) NOT NULL,
            receipt JSONB NOT NULL,
            CONSTRAINT pk_booking_requests PRIMARY KEY (workspace_id, actor_id, key),
            CONSTRAINT fk_booking_requests_workspace_id_workspaces
                FOREIGN KEY(workspace_id)
                REFERENCES workspaces (id),
            CONSTRAINT fk_booking_requests_actor_id_users
                FOREIGN KEY(actor_id)
                REFERENCES users (id)
        )
    """)
    op.execute("""
        CREATE TABLE booking_events (
            id UUID NOT NULL,
            workspace_id UUID NOT NULL,
            appointment_id UUID NOT NULL,
            version INTEGER NOT NULL,
            kind VARCHAR(30) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            payload JSONB NOT NULL,
            CONSTRAINT pk_booking_events PRIMARY KEY (id),
            CONSTRAINT fk_booking_events_workspace_id_appointments
                FOREIGN KEY(workspace_id, appointment_id)
                REFERENCES appointments (workspace_id, id),
            CONSTRAINT uq_booking_events_appointment_id UNIQUE (appointment_id, version)
        )
    """)


def downgrade() -> None:
    op.drop_table("booking_events")
    op.drop_table("booking_requests")
    op.drop_table("allocations")
    op.drop_table("appointments")
