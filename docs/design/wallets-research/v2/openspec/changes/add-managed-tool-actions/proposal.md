# Add managed tool actions

## Why

Agenta needs a small supported action catalog per managed integration, independent of whether the provider is reached through Composio, a direct API or MCP.

## What Changes

- Add managed_tools action definitions, registry, executor and provider implementations.
- Reuse Composio/MCP clients and existing permissions/secrets rather than rebuilding them.
- Use the enterprise usage-billing coordinator shared with models and sandbox, not a tool-specific ledger.
- Keep first provider/action and commercial permission pending; Apollo and LinkedIn are examples only.

## Capabilities

### New Capabilities

- `managed-tool-actions`: Stable action contracts backed by interchangeable provider implementations and shared billing.

### Modified Capabilities

None. This standalone package does not claim these capabilities are already published on main.

## Impact

Documentation and proposed behavior only. No implementation, merge, deployment, or commercial pricing approval. See the package README for source revisions and status.
