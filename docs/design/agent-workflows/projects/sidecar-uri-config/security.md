# Security

The whole design hinges on one fact: **a sidecar address chosen by the caller is an address the
service will send its secrets to.** This page is the threat model and the proposed restriction.
It is the load-bearing decision; the field itself is trivial without it.

## Why a caller-supplied address is dangerous

The service builds every `/run` body server-side and POSTs it, over plain HTTP with no auth, to
whatever URL `select_backend` resolves. That body can carry (verified in research §6 and the
sidecar-trust project):

- **`secrets`** — resolved provider credentials: OpenAI / Anthropic API keys and the full
  AWS / GCP / Azure credential groups, picked by the connection resolver from the project vault.
- **`toolCallback.authorization`** — a bearer token the runner uses to call gateway tools back
  on the platform.
- **`trace.authorization`** — the caller's own `Authorization` header value, reused for OTel
  export.

If the address comes from the request, then a request controls **where real provider keys and
two reusable bearer tokens are shipped, in plaintext**. Concretely:

| Threat | What an attacker gets |
| --- | --- |
| **Secret exfiltration** | Point `uri` at an attacker-controlled host; the service POSTs the vault-resolved provider keys + bearer tokens straight to it. |
| **SSRF** | Point `uri` at an internal address (`http://169.254.169.254/...`, a cluster service, `http://localhost:<other-port>`); the service makes the request from inside the trust boundary, with the bearer token attached. |
| **Trusted-network bypass** | The sidecar-trust project's near-term defense is "the sidecar only lives on a trusted network." A free-form caller `uri` lets the run leave that network entirely, voiding the assumption. |

This is why the reviewer's "the sandbox should probably use this uri to route" must be paired
with a server-side gate. The convenience (per-run runner selection) and the risk (per-run
secret destination) are the same mechanism.

## The restriction: a server-side allowlist, default-off

The override is honored **only** when its address is on a server-configured allowlist. The
caller proposes; the server disposes.

- **`AGENTA_AGENT_RUNNER_URI_ALLOWLIST`** — a comma-separated list of trusted sidecar origins,
  added to `api/oss/src/utils/env.py` and read via the shared `env` object (repo rule: no raw
  `os.getenv` for app config).
- **Default empty → every override rejected.** Out of the box, only `AGENTA_AGENT_RUNNER_URL` /
  the local CLI work; the `uri` field is inert until an operator opts in. This is the safe
  default: the feature ships off.
- `validate_runner_uri(uri)` compares the override's **origin** (scheme + host + port) against
  the allowlist. A match is honored; a miss raises a typed error surfaced as a 4xx. It does
  **not** silently fall back to the env var (that would let a caller probe the allowlist by
  difference and would mask a misconfiguration).

### Allowlist matching details to settle

- **Match on origin, not substring.** Parse the URL and compare scheme+host+port exactly, so
  `http://evil.com/?x=http://trusted` cannot smuggle a trusted substring past the check.
- **Block link-local / metadata by default.** Even with an empty allowlist this is moot (all
  rejected), but if an operator adds a broad entry, reject `169.254.0.0/16`,
  `100.64.0.0/10` (and the IPv6 equivalents) unless explicitly listed. SSRF defense in depth.
- **Loopback handling.** Decide whether `127.0.0.1` / `localhost` is implicitly allowed (it is
  the common single-host dev case) or must be listed like any other origin. Leaning: require it
  to be listed too, so the default is uniformly "nothing is trusted." (Open question O2.)
- **Scheme.** Restrict to `http`/`https`; reject `file:`, `gopher:`, etc.

## Relationship to the sidecar-trust project

This restriction is a **complement**, not a replacement, for the
[sidecar-trust-and-sandbox-enforcement](../sidecar-trust-and-sandbox-enforcement/README.md)
near-term hardening:

- That project's **step 1** (loopback / in-cluster-only binding) assumes the *set* of reachable
  sidecars is fixed by the network. A caller `uri` would break that assumption — the allowlist
  is exactly what re-establishes it at the application layer: the run can only target an address
  an operator pre-approved.
- That project's **step 2** (an optional shared `/run` token, `AGENTA_AGENT_RUNNER_TOKEN`)
  protects *any* address the service calls, including an allowlisted override. The two stack: the
  allowlist decides *which* sidecars are legal destinations; the token authenticates the service
  *to* that sidecar.
- The heavier items there (TLS / mTLS, short-lived scoped tokens, payload encryption) reduce the
  damage if an allowlisted address is ever compromised. They remain that project's deferred
  scope; this project does not design them.

## Recommendation

Ship the `uri` field and the allowlist gate **together, in the same change**, with the allowlist
**default-empty (feature off)**. A caller-supplied address must never be trusted before the
restriction exists. If the reviewer prefers the field to be operator-only (not playground-
editable) the risk surface shrinks further but the server-side allowlist is still required,
because a direct API caller bypasses the playground entirely.
