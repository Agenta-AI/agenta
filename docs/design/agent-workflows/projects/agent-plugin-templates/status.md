# Status

## Current scope

PR #6944 contains proposed specifications and examples only. The first version loads one agent from an internal source through the existing interface, then sends setup context in the first message. It reuses ordinary creation defaults and the existing build kit. Runtime implementation is NOT IMPLEMENTED.

## Review decisions

The PR review narrows the earlier multi-agent installation design. The current documents replace its lifecycle, custom setup tools, hidden context, new screens, and readiness gates. `/m` means the new default app on both desktop and mobile. MCP references and setup behavior now use the v0.119 baseline.

The old two-agent example is preserved as [a future fixture](future-example/README.md). Its behavior is NOT IMPLEMENTED. The current [example](example/README.md) contains one agent.

## Specification status

- Single-agent source/loading/first-message/interface specifications: drafted in OpenSpec; implementation tasks remain unchecked.
- Multi-agent specification: deferred, NOT IMPLEMENTED; not a version-one release requirement.
- Build-kit audit: completed against release/v0.119.0 at `ebb825d1da345e7bf9741e832d7664a972e6f72e`.
- Runtime and browser acceptance: NOT RUN in this docs-only change.

[Review responses](review-responses.md) record how every comment was handled. Validation command results are recorded there after checks run.
