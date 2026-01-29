# Data Model: Tools & Integrations

This document defines the database schema and data models for the tools/integrations feature.

## Overview

The data model consists of:

1. **ToolConnectionDB** - Stores project-to-integration connections (our DB)
2. **Integration data** - Cached from Composio (not persisted)
3. **Tool data** - Cached from Composio (not persisted)

We only persist what we own - the connection between a project and an external service. All integration/tool metadata comes from Composio and is cached.

---

## Database Schema

### Table: `tool_connections`

This table tracks which integrations are connected to which projects.

```sql
CREATE TABLE tool_connections (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    
    -- Scope (project-level)
    project_id UUID NOT NULL,
    
    -- Integration identification
    integration_slug VARCHAR(100) NOT NULL,      -- e.g., "gmail", "github"
    integration_name VARCHAR(255) NOT NULL,      -- e.g., "Gmail", "GitHub" (denormalized for display)
    
    -- Composio references
    composio_account_id VARCHAR(255),            -- Composio's connected_account ID (ca_xxx)
    composio_auth_config_id VARCHAR(255),        -- Optional: custom auth config ID (ac_xxx)
    
    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING, ACTIVE, FAILED, EXPIRED
    auth_type VARCHAR(20) NOT NULL,              -- OAUTH2, API_KEY, BASIC_AUTH
    
    -- Metadata
    meta JSONB,                                  -- Additional metadata if needed
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by_id UUID NOT NULL,
    updated_by_id UUID,
    
    -- Foreign keys
    CONSTRAINT fk_tool_connections_project 
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_tool_connections_created_by 
        FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_tool_connections_updated_by 
        FOREIGN KEY (updated_by_id) REFERENCES users(id) ON DELETE SET NULL,
    
    -- Business rules
    CONSTRAINT uq_tool_connections_project_integration 
        UNIQUE(project_id, integration_slug)    -- One connection per integration per project
);

-- Indexes
CREATE INDEX idx_tool_connections_project_id ON tool_connections(project_id);
CREATE INDEX idx_tool_connections_status ON tool_connections(status);
CREATE INDEX idx_tool_connections_integration ON tool_connections(integration_slug);
```

### Status Values

| Status | Description | Transitions |
|--------|-------------|-------------|
| `PENDING` | OAuth initiated, waiting for user | → ACTIVE, FAILED |
| `ACTIVE` | Connected and working | → EXPIRED |
| `FAILED` | Connection attempt failed | (terminal) |
| `EXPIRED` | Credentials expired | → ACTIVE (re-auth) |

### Auth Types

| Auth Type | Description | OAuth Flow? |
|-----------|-------------|-------------|
| `OAUTH2` | OAuth 2.0 authorization code flow | Yes |
| `API_KEY` | API key/token provided by user | No |
| `BASIC_AUTH` | Username/password | No |

---

## SQLAlchemy Model

```python
# api/oss/src/models/db_models.py

from datetime import datetime, timezone
from enum import Enum

import uuid_utils.compat as uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from oss.src.dbs.postgres.shared.base import Base


class ConnectionStatus(str, Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"


class AuthType(str, Enum):
    OAUTH2 = "OAUTH2"
    API_KEY = "API_KEY"
    BASIC_AUTH = "BASIC_AUTH"


class ToolConnectionDB(Base):
    __tablename__ = "tool_connections"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    
    # Scope
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    
    # Integration info
    integration_slug = Column(String(100), nullable=False)
    integration_name = Column(String(255), nullable=False)
    
    # Composio references
    composio_account_id = Column(String(255), nullable=True)
    composio_auth_config_id = Column(String(255), nullable=True)
    
    # Status
    status = Column(
        SQLEnum(ConnectionStatus),
        nullable=False,
        default=ConnectionStatus.PENDING,
    )
    auth_type = Column(
        SQLEnum(AuthType),
        nullable=False,
    )
    
    # Metadata
    meta = Column(JSONB, nullable=True)
    
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
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    
    # Relationships
    project = relationship("ProjectDB", back_populates="tool_connections")
    created_by = relationship("UserDB", foreign_keys=[created_by_id])
    updated_by = relationship("UserDB", foreign_keys=[updated_by_id])

    # Constraints
    __table_args__ = (
        # One connection per integration per project
        {"mysql_engine": "InnoDB"},
    )
```

---

## DTOs (Data Transfer Objects)

### Enums

```python
# api/oss/src/core/tools/enums.py

from enum import Enum


class ConnectionStatus(str, Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"


class AuthType(str, Enum):
    OAUTH2 = "OAUTH2"
    API_KEY = "API_KEY"
    BASIC_AUTH = "BASIC_AUTH"
```

### Integration DTOs (from Composio)

```python
# api/oss/src/core/tools/dtos.py

from typing import Optional, List
from pydantic import BaseModel


class IntegrationDTO(BaseModel):
    """Integration/Toolkit info from Composio, enriched with connection status."""
    slug: str                          # e.g., "gmail"
    name: str                          # e.g., "Gmail"
    description: Optional[str] = None
    logo_url: Optional[str] = None
    categories: List[str] = []
    auth_schemes: List[str] = []       # ["OAUTH2"], ["API_KEY"], etc.
    
    # Connection status (merged from our DB)
    is_connected: bool = False
    connection_id: Optional[str] = None
    connection_status: Optional[str] = None


class IntegrationDetailDTO(IntegrationDTO):
    """Extended integration details with auth config."""
    auth_config: Optional[dict] = None  # Auth requirements from Composio
```

### Tool DTOs (from Composio)

```python
class ToolSummaryDTO(BaseModel):
    """Tool summary for listing."""
    slug: str                          # e.g., "GMAIL_SEND_EMAIL"
    name: str                          # e.g., "Send Email"
    description: str
    integration_slug: str


class ToolDetailDTO(ToolSummaryDTO):
    """Full tool details with JSON Schema."""
    input_schema: dict                 # JSON Schema for inputs
    output_schema: dict                # JSON Schema for outputs
```

### Connection DTOs (our data)

```python
from uuid import UUID
from datetime import datetime
from typing import Optional

from oss.src.core.tools.enums import ConnectionStatus, AuthType


class ConnectionDTO(BaseModel):
    """Full connection record."""
    id: UUID
    project_id: UUID
    integration_slug: str
    integration_name: str
    composio_account_id: Optional[str] = None
    status: ConnectionStatus
    auth_type: AuthType
    created_at: datetime
    created_by_id: UUID


class CreateConnectionDTO(BaseModel):
    """Request to create a new connection."""
    integration_slug: str
    callback_url: Optional[str] = None  # For OAuth
    credentials: Optional[dict] = None  # For API key: {"api_key": "..."}


class CreateConnectionResponseDTO(BaseModel):
    """Response after initiating a connection."""
    id: UUID
    status: ConnectionStatus
    redirect_url: Optional[str] = None  # For OAuth
    message: str
```

### List Response DTOs

```python
class IntegrationListResponseDTO(BaseModel):
    """Response for listing integrations."""
    items: List[IntegrationDTO]
    total: int
    categories: List[str]              # Unique categories for filtering


class ToolListResponseDTO(BaseModel):
    """Response for listing tools."""
    items: List[ToolSummaryDTO]
    total: int


class ConnectionListResponseDTO(BaseModel):
    """Response for listing connections."""
    items: List[ConnectionDTO]
    total: int
```

---

## Cached Data Structures

These structures are cached in Redis/memory, not persisted in DB.

### Integration Catalog Cache

```python
# Cache key: tools:integrations
# TTL: 1 hour
{
    "integrations": [
        {
            "slug": "gmail",
            "name": "Gmail",
            "description": "Send and read emails...",
            "logo_url": "https://...",
            "categories": ["communication", "email"],
            "auth_schemes": ["OAUTH2"]
        },
        ...
    ],
    "categories": ["communication", "development", "productivity", ...],
    "cached_at": "2026-01-29T10:00:00Z"
}
```

### Tool List Cache

```python
# Cache key: tools:integrations:{slug}:tools
# TTL: 1 hour
{
    "tools": [
        {
            "slug": "GMAIL_SEND_EMAIL",
            "name": "Send Email",
            "description": "Send an email using Gmail",
            "integration_slug": "gmail"
        },
        ...
    ],
    "cached_at": "2026-01-29T10:00:00Z"
}
```

### Tool Schema Cache

```python
# Cache key: tools:integrations:{slug}:tools:{tool_slug}
# TTL: 1 hour
{
    "slug": "GMAIL_SEND_EMAIL",
    "name": "Send Email",
    "description": "Send an email using Gmail",
    "integration_slug": "gmail",
    "input_schema": { ... },
    "output_schema": { ... },
    "cached_at": "2026-01-29T10:00:00Z"
}
```

---

## DAO Interface

```python
# api/oss/src/core/tools/interfaces.py

from abc import ABC, abstractmethod
from typing import Optional, List
from uuid import UUID

from oss.src.core.tools.dtos import ConnectionDTO, CreateConnectionDTO
from oss.src.core.tools.enums import ConnectionStatus


class ToolConnectionsDAOInterface(ABC):
    """Interface for tool connections data access."""
    
    @abstractmethod
    async def create(
        self,
        *,
        project_id: UUID,
        created_by_id: UUID,
        dto: CreateConnectionDTO,
        composio_account_id: Optional[str] = None,
        status: ConnectionStatus = ConnectionStatus.PENDING,
    ) -> ConnectionDTO:
        """Create a new connection record."""
        ...
    
    @abstractmethod
    async def get(
        self,
        *,
        connection_id: UUID,
        project_id: Optional[UUID] = None,
    ) -> Optional[ConnectionDTO]:
        """Get a connection by ID."""
        ...
    
    @abstractmethod
    async def get_by_integration(
        self,
        *,
        project_id: UUID,
        integration_slug: str,
    ) -> Optional[ConnectionDTO]:
        """Get connection for a specific integration in a project."""
        ...
    
    @abstractmethod
    async def list(
        self,
        *,
        project_id: UUID,
        status: Optional[ConnectionStatus] = None,
    ) -> List[ConnectionDTO]:
        """List all connections for a project."""
        ...
    
    @abstractmethod
    async def update_status(
        self,
        *,
        connection_id: UUID,
        status: ConnectionStatus,
        composio_account_id: Optional[str] = None,
        updated_by_id: Optional[UUID] = None,
    ) -> Optional[ConnectionDTO]:
        """Update connection status."""
        ...
    
    @abstractmethod
    async def delete(
        self,
        *,
        connection_id: UUID,
        project_id: Optional[UUID] = None,
    ) -> bool:
        """Delete a connection."""
        ...
```

---

## Data Flow Diagrams

### Creating an OAuth Connection

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │   Agenta API    │     │   Composio      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ POST /connections     │                       │
         │─────────────────────>│                       │
         │                       │                       │
         │                       │ Create ToolConnectionDB
         │                       │ (status: PENDING)     │
         │                       │────────┐              │
         │                       │        │              │
         │                       │<───────┘              │
         │                       │                       │
         │                       │ POST /connected_accounts
         │                       │─────────────────────>│
         │                       │                       │
         │                       │     redirect_url      │
         │                       │<─────────────────────│
         │                       │                       │
         │     {redirect_url}    │                       │
         │<─────────────────────│                       │
         │                       │                       │
         │ Open popup            │                       │
         │──────────────────────────────────────────────>│
         │                       │                       │
         │                       │     OAuth flow        │
         │                       │<─────────────────────>│
         │                       │                       │
         │ Poll GET /connections/{id}                    │
         │─────────────────────>│                       │
         │                       │                       │
         │                       │ GET /connected_accounts/{id}
         │                       │─────────────────────>│
         │                       │                       │
         │                       │     status: ACTIVE    │
         │                       │<─────────────────────│
         │                       │                       │
         │                       │ Update ToolConnectionDB
         │                       │ (status: ACTIVE)     │
         │                       │────────┐              │
         │                       │<───────┘              │
         │                       │                       │
         │  {status: ACTIVE}     │                       │
         │<─────────────────────│                       │
```

### Fetching Tools for Connected Integration

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │   Agenta API    │     │   Redis Cache   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ GET /integrations/{slug}/tools               │
         │─────────────────────>│                       │
         │                       │                       │
         │                       │ Check cache           │
         │                       │─────────────────────>│
         │                       │                       │
         │                       │ Cache hit (or miss)  │
         │                       │<─────────────────────│
         │                       │                       │
         │                       │ If miss: fetch from Composio
         │                       │ and cache result     │
         │                       │                       │
         │     {tools: [...]}    │                       │
         │<─────────────────────│                       │
```

---

## Migration

### Up Migration

```sql
-- migrations/versions/xxx_add_tool_connections.py

def upgrade():
    op.create_table(
        'tool_connections',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('integration_slug', sa.String(100), nullable=False),
        sa.Column('integration_name', sa.String(255), nullable=False),
        sa.Column('composio_account_id', sa.String(255), nullable=True),
        sa.Column('composio_auth_config_id', sa.String(255), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, default='PENDING'),
        sa.Column('auth_type', sa.String(20), nullable=False),
        sa.Column('meta', postgresql.JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('updated_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.UniqueConstraint('project_id', 'integration_slug'),
    )
    
    op.create_index('idx_tool_connections_project_id', 'tool_connections', ['project_id'])
    op.create_index('idx_tool_connections_status', 'tool_connections', ['status'])
    op.create_index('idx_tool_connections_integration', 'tool_connections', ['integration_slug'])


def downgrade():
    op.drop_table('tool_connections')
```

---

## Related Documents

- [API Design](./api-design.md) - Endpoint specifications
- [Composio OAuth Research](./pre-research/research-composio-oauth.md) - OAuth flow details
