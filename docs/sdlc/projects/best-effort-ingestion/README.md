# Best-Effort OTLP Ingestion

## Overview

This project improves the resilience of Agenta's OTLP trace ingestion pipeline. The goal is to ensure that a single bad field, span, or transient error doesn't cause cascading loss of unrelated good data.

## Origin

This work originated from fixing the TypeScript/Node.js OpenTelemetry examples in the docs. We discovered that OTel JS SDKs send structured data as JSON strings because `setAttribute()` only accepts primitives. The backend then failed strict validation and **silently dropped entire spans**.

Further investigation revealed multiple places in the pipeline where a single failure can cause disproportionate data loss.

## Documents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, motivation, problem statement, goals, non-goals |
| [plan.md](./plan.md) | High-level execution plan with phases and implementation details |
| [research.md](./research.md) | Pipeline failure analysis and external strategy comparison |
| [status.md](./status.md) | Living document with progress updates and decisions |

## Quick Links

- **Worktree deployment**: `http://144.76.237.122:8480`
- **Branch**: `feat/otlp-best-effort-hardening`
- **Key files modified**:
  - `api/oss/src/apis/fastapi/tracing/utils.py`
  - `api/oss/src/apis/fastapi/otlp/router.py`
  - `api/oss/src/apis/fastapi/otlp/opentelemetry/otlp.py`
  - `api/oss/src/apis/fastapi/otlp/extractors/adapter_registry.py`
  - `api/oss/tests/pytest/unit/otlp/*`
  - `api/oss/tests/pytest/unit/tracing/test_utils.py`
