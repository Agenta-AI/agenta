# Research

## Review baseline

The initial review found these problems across the five-PR stack:

- #6164 removed the Vault list cache, allowed `write_only` changes during update, returned
  key-specific `has_key` and `key_preview` fields, and reused one DTO hierarchy for incompatible
  create, update, trusted-read, and public-response roles.
- The update resolver mutated its caller DTO, while the DAO mixed row-lock mechanics with
  write-only policy.
- Runtime proof could inherit the administrator key and deployment failure behavior was incomplete.
- SSO depended on an implicit visibility default, and every readable SSO/webhook creation path
  needed an explicit audit.
- #6165 stored a free-form public `managed_by` string and exposed a universal
  `allow_managed=True` bypass.
- #6138 reused one marker for proxy metadata, Vault ownership, and user-facing copy.
- #6174 hand-maintained backend response fields around a generated Fern type.
- #6195 could spend a managed plaintext credential through a caller-configured provider probe.
- Python SDK consumers still read the removed `has_key` field after the API moved to
  `value_status`.

## Final implementation

- Vault list reads cache canonical trusted DTOs and apply caller projection after retrieval.
- `write_only` is selected at creation and cannot change through update.
- Public responses use `value_status`; all Python SDK consumers read that same structure.
- Omitted update credentials keep the locked-row value. Explicit blank provider credentials are
  invalid. The co-released frontend omits untouched credentials.
- `AGENTA_SERVICES_INTERNAL_KEY` is the only internal proof and is mandatory at API startup.
- SSO and webhooks explicitly remain readable.
- Managed storage uses typed internal manager identity and public mutation policy. General
  mutations have no ownership bypass.
- The starter-credit bridge creates one explicitly managed and explicitly write-only row.
- Managed credentials cannot be spent through the provider-probe path.
- Fern Python and TypeScript clients are generated from the final combined OpenAPI contract in
  #6174, which also contains the frontend consumers.

## Storage compatibility

`write_only` and structured `management` live inside the existing encrypted JSON payload. Rows
without those fields map to readable and unmanaged defaults. No database migration is required.

## Interface classification

- Secret value fields are credential data.
- `write_only` is value-visibility policy selected at resource creation.
- `management.manager` is internal lifecycle ownership metadata.
- `management.policy` is public user-mutation policy.
- `value_status` is public response metadata derived from the trusted value.
- Runtime grants are authorization policy carried in signed protocol context.

The final models keep these roles separate. The frontend receives public policy and status, not
the internal manager identifier.

## Workspace boundary

The secrets stack shares a GitButler workspace with unrelated Pi-traces, website, hooks, and other
work. Only secrets-owned changes belong in these five PRs. The Pi branches and runner files remain
out of scope.
