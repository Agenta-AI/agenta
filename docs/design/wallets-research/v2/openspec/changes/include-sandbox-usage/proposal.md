# Include sandbox usage

## Why

Free and lifetime users need a bounded sandbox allowance even with zero wallet credits. Included compute must not become spendable money for model or tool calls.

## What Changes

- Add included sandbox quantity as a non-monetary entitlement.
- Support configurable hard stop or wallet overage, with no default commercial choice implied.
- Meter authoritative provider-billable usage and expose included versus paid portions.

## Capabilities

### New Capabilities

- `included-sandbox-usage`: Resource-specific included compute followed by optional wallet-funded overage.

### Modified Capabilities

None. This standalone package does not claim these capabilities are already published on main.

## Impact

Documentation and proposed behavior only. No implementation, merge, deployment, or commercial pricing approval. See the package README for source revisions and status.
