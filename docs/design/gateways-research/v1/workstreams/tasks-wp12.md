# WP12 — tasks

Read [`specs-wp12.md`](specs-wp12.md) first. Branch from the wave-2 seed commit.

## models.py — what a resolved connection now carries

- [ ] Read `connections/models.py` end to end before editing. `ResolvedConnection`'s
      validators encode rules this package must keep, not route around.
- [ ] Confirm the seed's gateway-credentials field is present and materialized (D36). If it
      is missing, stop — every downstream package inherits it and it is not this package's
      to invent.
- [ ] Extend the validator: `credential_mode == "none"` with the gateway-credentials field
      set is now a legal combination, and is the normal one.
- [ ] Unit: the combination validates; a provider secret in `credentials` alongside the
      gateway field does not.

## resolve.py — the route

- [ ] `platform/resolve.py::resolve_connection`: build the base URL as
      `{gateway_base}/gateways/llms/{namespace}/{name}` from D30's grammar —
      `standard/{provider_key}` for a generated endpoint, `custom/{slug}` for a row.
- [ ] The protocol path stays the harness's: the base URL ends at the endpoint, with no
      `/v1/...` suffix.
- [ ] Where the gateway base URL comes from is configuration, through the shared `env`
      object (`api/AGENTS.md`), never `os.getenv` at the call site.
- [ ] Set `credential_mode="none"`, leave `credentials` empty, fill the gateway-credentials
      field from the minted token (D13's signer, unchanged).
- [ ] A target whose protocol has no front door raises, naming target and protocol. No
      fallback to a direct connection — a silent bypass of the gateway is the one outcome
      worse than an error.

## resolver.py — the two resolvers

- [ ] `EnvConnectionResolver` and `StaticConnectionResolver` both keep working. They are the
      local and test paths; if either can no longer express a connection, that is a finding
      to report, not a shape to change here.
- [ ] Unit: each resolver's existing tests pass, or a changed expectation is listed in this
      file with its reason.

## Tests

- [ ] Unit: one resolved connection per (provider, deployment) pair the resolver supports —
      base URL is the gateway's, `credentials` empty, `credential_mode` `none`, gateway
      field populated.
- [ ] Unit, structural: `model_dump_json()` carries no upstream secret, for every pair.
      Assert on the dump, not on named fields — a field added later must fail this test.
- [ ] Unit: loopback http passes the validator; non-loopback http still fails (D37).
- [ ] Unit: a target with no front door raises.
- [ ] `ruff format` && `ruff check --fix` in `sdks/python`; run the SDK unit tests.
- [ ] Commit: "gateways(sdk): resolve connections to the gateway route".

## Definition of done

- No resolved connection carries an upstream secret, for any provider or deployment.
- Every capability the resolver had, it still has.
- WP13, WP14 and WP15 can branch from this and read one shape.
