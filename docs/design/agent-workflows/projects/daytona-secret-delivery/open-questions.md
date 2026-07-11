# Open questions before implementation

These decisions block implementation. The recommendation under each question is the current design
preference, not an approved decision.

## 1. What production Daytona boundary can we require?

Daytona grants `manage:secrets` across an organization, not only Agenta-created Secrets.

- **Option A:** require a dedicated Daytona organization and dedicated runner credential.
- **Option B:** use a shared organization and explicitly accept organization-wide management blast
  radius.

**Recommendation:** Option A. A separate API key alone does not narrow the permission.

## 2. What happens to SigV4 and Vertex service-account connections?

Daytona substitution cannot protect values used for local signing or token minting.

- **Option A:** keep the current plaintext behavior as an explicit `non_isolated` mode.
- **Option B:** disable those connections on Daytona until a gateway exists.
- **Option C:** require provider-specific opaque credentials where available.

**Recommendation:** allow A during migration, prefer C when available, and make B available to
operators that require strict isolation. Never downgrade from `isolated` to `non_isolated`
automatically.

## 3. Where is the effective model endpoint resolved?

Custom and Azure connections already carry a base URL. Standard providers and regional Bedrock
routes also need an exact effective endpoint so the host policy matches the client request.

- **Option A:** the Python connection resolver emits the effective endpoint for every deployment.
- **Option B:** the runner maintains a provider-host registry.

**Recommendation:** Option A. Routing knowledge and its credential should travel under the same
consumer. A second registry can drift.

## 4. Does Daytona substitute placeholders passed directly in HTTP MCP headers?

The runner can obtain the Secret placeholder and put it in ACP session configuration, but Daytona's
documentation demonstrates environment injection rather than this exact path.

**Recommendation:** make this a Phase 0 live gate. If direct placeholder substitution fails, either
teach the in-sandbox MCP adapter to read a Secret-backed environment binding or keep HTTP MCP
credentials on a runner-side gateway.

## 5. Where does durable lease metadata live?

Cleanup needs a durable mapping from sandbox ID to Secret IDs, host policy, and lifecycle state.
Session state is already durable, but the janitor also needs organization-wide enumeration and
partial-provisioning recovery.

**Recommendation:** define a small runner-owned lease record in the control plane rather than
encoding user metadata into Daytona Secret names or descriptions.

## 6. Is explicit non-isolated delivery visible in the public configuration or only operator policy?

Users may need to know that a selected cloud credential remains readable inside Daytona. Exposing
mechanism-specific Daytona settings in the agent contract would be the wrong abstraction.

**Recommendation:** expose a portable credential-delivery requirement such as `isolated_required`
or `best_available`, then report the resolved mode in run metadata. Keep Daytona details internal.

## 7. Do we support Vertex API keys in the first scope?

Google now documents API-key authentication for some Vertex Gemini paths, while Agenta's current
Vertex connection uses Application Default Credentials through `GOOGLE_APPLICATION_CREDENTIALS`.

**Recommendation:** keep Vertex API keys out of the first scope unless the provider-model contract
adds and tests that distinct credential shape. Do not infer it from service-account configuration.

## 8. What exact Daytona SDK and self-hosted control-plane versions are supported?

Secrets first shipped in SDK 0.192.0. The current package is 0.196.0, while the runner still uses
`@daytonaio/sdk` 0.187.0. Self-hosted control-plane compatibility is not yet proven.

**Recommendation:** select one exact `@daytona/sdk` version after the live spike and add startup
capability validation for the minimum control-plane version.
