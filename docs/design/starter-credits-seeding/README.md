# Starter credits seeding

This document records the production contract for the starter-credits connection created for a
new organization's default project.

## Seeding flow

The EE signup hook calls the starter-credits bridge. The bridge:

1. Confirms the bridge configuration and `AGENTA_SERVICES_INTERNAL_KEY` are configured.
2. Resolves the mint policy and verifies the proxy team budget ceiling.
3. Loads the organization's default project and checks the `starter-credits` Vault slug.
4. Applies the signup and velocity policy.
5. Mints one budget-capped proxy key for the organization.
6. Creates one managed Vault connection through `VaultService.create_managed_secret`.

The proxy alias and the project-plus-slug unique constraint make duplicate signup attempts
idempotent. If the Vault write fails after minting, the bridge blocks the orphaned proxy key.

## Vault connection contract

The bridge creates a custom-provider connection with these independent properties:

| Property | Value | Purpose |
| --- | --- | --- |
| Slug | `starter-credits` | Stable Vault identity |
| Name | `Agenta` | User-facing connection name and model-key namespace |
| Description | `Provided and managed by Agenta.` | User-facing explanation |
| Provider URL | `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_PUBLIC_URL` | Endpoint used by model runs |
| `write_only` | `true` | Prevents ordinary API and UI callers from reading the virtual key |
| Manager | `SecretManager.STARTER_CREDITS_BRIDGE` | Identifies the trusted lifecycle owner internally |
| Management policy | `SecretManagementPolicy.MANAGER_ONLY` | Prevents general update and delete operations |

Management and value visibility are separate policies. The bridge selects both explicitly. The
general Vault layer does not infer `write_only` from management.

The public Vault response exposes the management policy, not the internal manager identity.

## Names with different roles

The bridge keeps these values separate even when two serialized values happen to match:

- `PROXY_ORIGIN` is proxy audit metadata attached to the minted key.
- `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_ADMIN_URL` routes administrative mint and block calls.
- `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_PUBLIC_URL` is stored as the connection endpoint.
- `STARTER_CREDITS_DESCRIPTION` is human-facing copy stored in the Vault header.

Do not reuse the proxy origin or either URL as the user-facing description.

## Cache ownership

`VaultService.create_managed_secret` owns Vault list-cache invalidation. The bridge does not call
the cache helper directly. This keeps HTTP and in-process Vault writers on the same invalidation
path.

## Runtime key requirement

The bridge refuses to mint when `AGENTA_SERVICES_INTERNAL_KEY` is absent, blank, or the
`replace-me` placeholder. It does not fall back to `AGENTA_AUTH_KEY`. Without the dedicated key,
the runtime cannot obtain the grant required to resolve the write-only connection.
