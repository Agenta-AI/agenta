# Database Schema Proposal

## Overview

Two main tables needed:
1. **webhooks** - Webhook endpoint configurations
2. **webhook_deliveries** - Delivery queue and history

Plus optional tables for v2:
3. **webhook_event_types** - Event type registry
4. **webhook_delivery_attempts** - Detailed attempt history

---

## Core Tables

### 1. webhooks (Webhook Subscriptions)

```sql
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    
    -- Ownership
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    -- Configuration
    name VARCHAR(255) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    secret VARCHAR(255) NOT NULL,  -- HMAC signing secret
    
    -- Filtering (which events to receive)
    event_types JSONB NOT NULL DEFAULT '["*"]',  -- ["config.deployed", "config.committed"] or ["*"]
    
    -- Optional filters
    application_id UUID REFERENCES app_db(id) ON DELETE SET NULL,  -- Filter by app
    environment_name VARCHAR(255),  -- Filter by environment (e.g., "production")
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    description TEXT,
    headers JSONB DEFAULT '{}',  -- Custom headers to include
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Constraints
    CONSTRAINT webhooks_url_check CHECK (url ~ '^https?://'),
    CONSTRAINT webhooks_event_types_check CHECK (jsonb_typeof(event_types) = 'array')
);

-- Indexes
CREATE INDEX idx_webhooks_project_id ON webhooks(project_id);
CREATE INDEX idx_webhooks_project_active ON webhooks(project_id, is_active) WHERE is_active = true;
CREATE INDEX idx_webhooks_application_id ON webhooks(application_id) WHERE application_id IS NOT NULL;
```

### 2. webhook_deliveries (Delivery Queue & History)

```sql
CREATE TYPE webhook_delivery_status AS ENUM (
    'pending',    -- Waiting to be delivered
    'delivering', -- Currently being delivered (prevents duplicate pickup)
    'delivered',  -- Successfully delivered
    'failed'      -- Failed after all retries exhausted
);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    
    -- Reference
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    
    -- Event data
    event_id UUID NOT NULL,  -- Idempotency key
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    
    -- Delivery state
    status webhook_delivery_status NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 6,
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Results
    last_attempt_at TIMESTAMPTZ,
    last_response_status INTEGER,
    last_response_body TEXT,
    last_error TEXT,
    
    -- Success tracking
    delivered_at TIMESTAMPTZ,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT webhook_deliveries_attempts_check CHECK (attempts >= 0)
);

-- Indexes for queue processing
CREATE INDEX idx_webhook_deliveries_pending 
    ON webhook_deliveries(scheduled_at) 
    WHERE status = 'pending';

CREATE INDEX idx_webhook_deliveries_webhook_id 
    ON webhook_deliveries(webhook_id);

CREATE INDEX idx_webhook_deliveries_event_id 
    ON webhook_deliveries(event_id);

-- For cleanup/retention policies
CREATE INDEX idx_webhook_deliveries_created_at 
    ON webhook_deliveries(created_at);
```

---

## SQLAlchemy Models

```python
# api/oss/src/models/db_models.py

from enum import Enum as PyEnum

class WebhookDeliveryStatus(PyEnum):
    PENDING = "pending"
    DELIVERING = "delivering"
    DELIVERED = "delivered"
    FAILED = "failed"


class WebhookDB(Base):
    __tablename__ = "webhooks"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    
    # Ownership
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    
    # Configuration
    name = Column(String(255), nullable=False)
    url = Column(String(2048), nullable=False)
    secret = Column(String(255), nullable=False)  # Encrypted at rest
    
    # Filtering
    event_types = Column(
        mutable_json_type(dbtype=JSONB, nested=True),
        nullable=False,
        default=["*"],
    )
    application_id = Column(
        UUID(as_uuid=True),
        ForeignKey("app_db.id", ondelete="SET NULL"),
        nullable=True,
    )
    environment_name = Column(String(255), nullable=True)
    
    # Status
    is_active = Column(Boolean, nullable=False, default=True)
    
    # Metadata
    description = Column(String, nullable=True)
    headers = Column(
        mutable_json_type(dbtype=JSONB, nested=True),
        nullable=True,
        default={},
    )
    
    # Audit
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    created_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    project = relationship("ProjectDB")
    application = relationship("AppDB")
    created_by = relationship("UserDB")


class WebhookDeliveryDB(Base):
    __tablename__ = "webhook_deliveries"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    
    # Reference
    webhook_id = Column(
        UUID(as_uuid=True),
        ForeignKey("webhooks.id", ondelete="CASCADE"),
        nullable=False,
    )
    
    # Event data
    event_id = Column(UUID(as_uuid=True), nullable=False)
    event_type = Column(String(255), nullable=False)
    payload = Column(
        mutable_json_type(dbtype=JSONB, nested=True),
        nullable=False,
    )
    
    # Delivery state
    status = Column(
        Enum(WebhookDeliveryStatus, name="webhook_delivery_status"),
        nullable=False,
        default=WebhookDeliveryStatus.PENDING,
    )
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=6)
    
    # Scheduling
    scheduled_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    
    # Results
    last_attempt_at = Column(DateTime(timezone=True), nullable=True)
    last_response_status = Column(Integer, nullable=True)
    last_response_body = Column(String, nullable=True)
    last_error = Column(String, nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    
    # Audit
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    webhook = relationship("WebhookDB")
```

---

## Migration Script

```python
# alembic/versions/xxxx_add_webhooks_tables.py

def upgrade():
    # Create enum type
    op.execute("""
        CREATE TYPE webhook_delivery_status AS ENUM (
            'pending', 'delivering', 'delivered', 'failed'
        )
    """)
    
    # Create webhooks table
    op.create_table(
        'webhooks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid7),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('url', sa.String(2048), nullable=False),
        sa.Column('secret', sa.String(255), nullable=False),
        sa.Column('event_types', JSONB, nullable=False, server_default='["*"]'),
        sa.Column('application_id', UUID(as_uuid=True), sa.ForeignKey('app_db.id', ondelete='SET NULL'), nullable=True),
        sa.Column('environment_name', sa.String(255), nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('description', sa.String, nullable=True),
        sa.Column('headers', JSONB, nullable=True, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    
    op.create_index('idx_webhooks_project_id', 'webhooks', ['project_id'])
    op.create_index('idx_webhooks_project_active', 'webhooks', ['project_id', 'is_active'], postgresql_where='is_active = true')
    
    # Create webhook_deliveries table
    op.create_table(
        'webhook_deliveries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid7),
        sa.Column('webhook_id', UUID(as_uuid=True), sa.ForeignKey('webhooks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_id', UUID(as_uuid=True), nullable=False),
        sa.Column('event_type', sa.String(255), nullable=False),
        sa.Column('payload', JSONB, nullable=False),
        sa.Column('status', sa.Enum('pending', 'delivering', 'delivered', 'failed', name='webhook_delivery_status'), nullable=False, server_default='pending'),
        sa.Column('attempts', sa.Integer, nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer, nullable=False, server_default='6'),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('last_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_response_status', sa.Integer, nullable=True),
        sa.Column('last_response_body', sa.String, nullable=True),
        sa.Column('last_error', sa.String, nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    
    op.create_index('idx_webhook_deliveries_pending', 'webhook_deliveries', ['scheduled_at'], postgresql_where="status = 'pending'")
    op.create_index('idx_webhook_deliveries_webhook_id', 'webhook_deliveries', ['webhook_id'])


def downgrade():
    op.drop_table('webhook_deliveries')
    op.drop_table('webhooks')
    op.execute('DROP TYPE webhook_delivery_status')
```

---

## Data Retention

Recommended retention policy for `webhook_deliveries`:

```sql
-- Run daily via cron/scheduler
DELETE FROM webhook_deliveries 
WHERE created_at < NOW() - INTERVAL '30 days'
  AND status IN ('delivered', 'failed');
```

Or use PostgreSQL's `pg_partman` for automatic partition management by date.
