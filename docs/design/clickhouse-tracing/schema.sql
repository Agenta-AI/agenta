CREATE TABLE IF NOT EXISTS spans
(
    project_id UUID,
    created_at DateTime64(6, 'UTC'),
    updated_at Nullable(DateTime64(6, 'UTC')),
    deleted_at Nullable(DateTime64(6, 'UTC')),
    created_by_id UUID,
    updated_by_id Nullable(UUID),
    deleted_by_id Nullable(UUID),

    trace_id UUID,
    span_id UUID,
    parent_id Nullable(UUID),

    trace_type LowCardinality(String),
    span_type LowCardinality(String),
    span_kind LowCardinality(String),
    span_name String,

    start_time DateTime64(6, 'UTC'),
    end_time DateTime64(6, 'UTC'),

    status_code LowCardinality(String),
    status_message Nullable(String),

    attributes JSON,
    `references` JSON,
    links JSON,
    hashes JSON,
    events JSON
)
ENGINE = MergeTree
PARTITION BY toDate(created_at)
ORDER BY (project_id, trace_id, span_id, created_at)
SETTINGS index_granularity = 8192;
