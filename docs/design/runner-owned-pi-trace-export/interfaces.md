# Interfaces

## Field classification

| Value | Semantic role | Owner | Changes | Destination |
|---|---|---|---|---|
| `traceparent` | Protocol context | Calling trace | Every turn | Pi control file and runner tracer |
| `baggage` | Protocol context | Calling trace | Every turn | Pi control file and runner tracer |
| content capture | Policy | Operator or service | May change every turn | Pi control file and runner tracer |
| OTLP endpoint | Exporter configuration | Operator or SDK | May change every turn | Runner only |
| general platform authorization | Credential | Access system | Rotates during a turn | Runner credential lease only |
| channel ID | Transport correlation | Runner | Every turn | Runner and Pi spool filenames |
| OTLP protobuf body | Telemetry data | Pi tracer | Once per turn | Pi spool to runner export sink |
| session ID and turn ID | Runtime metadata | Runner request | Per session and turn | Control file and diagnostics |

This classification is the reason `exportAuthorization` is unnecessary. The runner already owns a
renewable general platform credential. Pi needs telemetry data and protocol context, not a
credential.

## External `/run` wire

### Required contract for the feature

The runner needs these logical inputs:

```json
{
  "context": {
    "propagation": {
      "traceparent": "00-...-...-01",
      "baggage": "..."
    }
  },
  "telemetry": {
    "capture": {
      "content": { "enabled": true }
    },
    "exporters": {
      "otlp": {
        "endpoint": "https://example/api/otlp/v1/traces",
        "headers": {
          "authorization": "Secret ..."
        }
      }
    }
  }
}
```

No new field is needed to ship runner-owned export. The existing `headers.authorization` remains
the compatibility source for the runner's general credential during the first implementation.
The runner must resolve it once into its shared current-authorization provider; tracing and
session code consume that provider instead of repeatedly reading the telemetry DTO.

Do not add:

- `telemetry_credentials` to middleware state;
- `TraceContext.export_authorization`;
- `WireOtlpExporter.exportAuthorization`;
- an OTLP-only token scope;
- a fixed export-token TTL.

### Follow-up contract cleanup

The current general credential is semantically misplaced under the OTLP exporter even though many
runner platform calls use it. Clean that separately after the runner-owned exporter is stable.

Proposed canonical shape:

```json
{
  "platform": {
    "headers": {
      "authorization": "Secret ..."
    }
  },
  "context": {
    "propagation": {
      "traceparent": "00-...-...-01",
      "baggage": "..."
    }
  },
  "telemetry": {
    "capture": {
      "content": { "enabled": true }
    },
    "exporters": {
      "otlp": {
        "endpoint": "https://example/api/otlp/v1/traces"
      }
    }
  }
}
```

`platform.headers.authorization` is a credential under the platform it authenticates.
`telemetry.exporters.otlp.endpoint` remains exporter configuration. There is no exporter credential
on the normal Agenta path because the runner derives export authorization from its platform lease.

For a third-party collector that requires its own static header, keep that header under the OTLP
exporter. Its credential source is static and non-renewable, distinct from the Agenta platform
lease.

Migration should be explicit:

1. Runner reads `platform.headers.authorization` first and falls back to the legacy OTLP header.
2. SDK emits both fields during the compatibility window if old runners must remain supported.
3. Golden wire tests pin both the compatibility phase and final removal.
4. Remove the legacy general credential from telemetry only after the minimum supported runner
   version accepts `platform`.

## Pi control file

Stable path supplied once through the Pi process environment:

```text
AGENTA_AGENT_TELEMETRY_CONTROL_PATH=<runtimeIpcDir>/telemetry/current.control.json
```

Version 1 body:

```json
{
  "version": 1,
  "channelId": "f3e7d4...",
  "turnId": "019...",
  "sessionId": "019...",
  "propagation": {
    "traceparent": "00-...-...-01",
    "baggage": "..."
  },
  "capture": {
    "content": true
  },
  "skills": ["_agenta.default"]
}
```

Rules:

- Runner writes a temporary sibling and atomically renames it to the stable path.
- Pi reads and deletes the stable file in `before_agent_start`.
- Pi rejects unknown versions and malformed channel IDs.
- Missing optional fields mean the same defaults as today.
- The file contains no endpoint or credential.
- The runner keeps its authoritative copy in memory. It never trusts the file on return.

## Pi OTLP spool

Final filename:

```text
<runtimeIpcDir>/telemetry/<channelId>.otlp.pb
```

Publication:

```text
write <channelId>.otlp.pb.tmp.<nonce>
rename to <channelId>.otlp.pb
```

Payload:

- raw OTLP `ExportTraceServiceRequest` protobuf bytes;
- content type fixed by the runner to `application/x-protobuf`;
- one complete Pi run per file;
- no JSON envelope, base64 encoding, header map, endpoint, or credential.

Consumer rules:

- Start and finish are scoped to one turn.
- Accept only the expected final filename.
- One accepted file per turn in version 1.
- Mirror the API's configured maximum batch size, with an absolute runner safety ceiling.
- Delete on pickup and keep bytes in memory for the bounded export attempt.
- Sweep final and temporary telemetry files before publishing the next control file.

## Internal credential interface

```ts
type AuthorizationProvider = () => string | undefined;
```

Properties:

- initialized from the credential on the current request;
- refreshed by the existing session alive watchdog while a session-owned turn is active;
- read immediately before every runner or Pi-spool export;
- kept static for third-party collector authorization;
- value and raw JWT claims never logged.

Do not create a second trace-specific lease or refresh channel.

## Internal export interface

```ts
interface OtlpBytesExportRequest {
  body: Uint8Array;
  target: {
    endpoint: string;
    authorization: AuthorizationProvider;
  };
  diagnostics: PiSpoolDiagnostics;
}
```

`exportOtlpBytes()` is best-effort and resolves after success, final failure, or timeout. It
preserves existing retry and diagnostics behavior and does not throw into agent execution.

## Compatibility rules

- A runner without the new spool path continues current behavior.
- The runner bundles and installs its matching Pi extension in both placements, so the runner,
  extension, and control protocol cut over atomically in one image release.
- Do not add a feature flag or support a mixed new-runner/old-extension mode.
- Direct Pi network export and runner spool export never run together.
- Runner logs identify `source=pi-spool` or `source=runner-acp` so duplicate paths are visible.

