"""
ClickHouse database entities (schema) for tracing.

This module defines the ClickHouse table structures for storing trace spans.
"""

from typing import Optional
from dataclasses import dataclass
from datetime import datetime


@dataclass
class SpanCHE:
    """ClickHouse Span Entity - represents a single span in the spans table."""

    # Identifiers
    project_id: str  # UUID as string
    trace_id: str  # UUID as string
    span_id: str  # UUID as string
    parent_id: Optional[str] = None  # UUID as string

    # Span type information
    trace_type: Optional[str] = None  # Enum value as string
    span_type: Optional[str] = None  # Enum value as string
    span_kind: str = ""  # Enum value as string
    span_name: str = ""

    # Timing
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

    # Status
    status_code: str = "UNSET"  # Enum value as string
    status_message: Optional[str] = None

    # Attributes and metadata
    attributes: Optional[str] = None  # JSON as string
    references: Optional[str] = None  # JSON as string
    links: Optional[str] = None  # JSON as string
    hashes: Optional[str] = None  # JSON as string
    events: Optional[str] = None  # JSON as string

    # Lifecycle
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    created_by_id: Optional[str] = None  # UUID as string
    updated_by_id: Optional[str] = None  # UUID as string
    deleted_by_id: Optional[str] = None  # UUID as string


# ClickHouse DDL for spans table
CLICKHOUSE_SPANS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS spans (
    -- Identifiers
    project_id String,
    trace_id String,
    span_id String,
    parent_id Nullable(String),

    -- Span type information
    trace_type Nullable(String),
    span_type Nullable(String),
    span_kind String,
    span_name String,

    -- Timing
    start_time Nullable(DateTime),
    end_time Nullable(DateTime),

    -- Status
    status_code String,
    status_message Nullable(String),

    -- Attributes and metadata
    attributes Nullable(String),
    references Nullable(String),
    links Nullable(String),
    hashes Nullable(String),
    events Nullable(String),

    -- Lifecycle
    created_at DateTime,
    updated_at Nullable(DateTime),
    deleted_at Nullable(DateTime),
    created_by_id Nullable(String),
    updated_by_id Nullable(String),
    deleted_by_id Nullable(String)
)
ENGINE = MergeTree()
PRIMARY KEY (project_id, trace_id, span_id)
ORDER BY (project_id, created_at, trace_id, span_id)
SETTINGS index_granularity = 8192
"""

# ClickHouse DDL for replacing spans (using ReplacingMergeTree for updates)
CLICKHOUSE_SPANS_TABLE_REPLACING_DDL = """
CREATE TABLE IF NOT EXISTS spans (
    -- Identifiers
    project_id String,
    trace_id String,
    span_id String,
    parent_id Nullable(String),

    -- Span type information
    trace_type Nullable(String),
    span_type Nullable(String),
    span_kind String,
    span_name String,

    -- Timing
    start_time Nullable(DateTime),
    end_time Nullable(DateTime),

    -- Status
    status_code String,
    status_message Nullable(String),

    -- Attributes and metadata
    attributes Nullable(String),
    references Nullable(String),
    links Nullable(String),
    hashes Nullable(String),
    events Nullable(String),

    -- Lifecycle
    created_at DateTime,
    updated_at Nullable(DateTime),
    deleted_at Nullable(DateTime),
    created_by_id Nullable(String),
    updated_by_id Nullable(String),
    deleted_by_id Nullable(String),

    -- Version for ReplacingMergeTree
    version UInt32 DEFAULT 1
)
ENGINE = ReplacingMergeTree(version)
PRIMARY KEY (project_id, trace_id, span_id)
ORDER BY (project_id, created_at, trace_id, span_id)
SETTINGS index_granularity = 8192
"""


@dataclass
class NodeCHE:
    """ClickHouse Node Entity - represents a single node in the nodes table."""

    project_id: str  # UUID as string
    node_id: str  # String identifier
    tree_id: Optional[str] = None
    root_id: Optional[str] = None
    created_at: Optional[datetime] = None
    attributes: Optional[str] = None  # JSON as string


CLICKHOUSE_NODES_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS nodes (
    project_id String,
    node_id String,
    tree_id Nullable(String),
    root_id Nullable(String),
    created_at DateTime,
    attributes Nullable(String)
)
ENGINE = MergeTree()
PRIMARY KEY (project_id, node_id)
ORDER BY (project_id, created_at, node_id)
SETTINGS index_granularity = 8192
"""
