"""
Ad-hoc workers for Redis Streams.

These are hand-made workers (not Taskiq-managed) that consume from Redis Streams
using consumer groups and XREADGROUP.

Structure:
- base_worker.py - Base class for all Redis Streams workers
- tracing/worker.py - TracingWorker for streams:otlp:spans
- observability/worker.py - ObservabilityWorker for streams:otlp:nodes
"""
