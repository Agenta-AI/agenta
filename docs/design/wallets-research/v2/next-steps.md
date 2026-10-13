# Next implementation steps

## Recommended order

1. Review and accept the specification boundaries, particularly original soft model admission versus the newer bounded-spending requirements. No prices are needed. Keep the original foundation separate from new product behavior.
2. Finish exact-head foundation review and deployment acceptance for #6050. Merge only with explicit authorization and keep paid behavior disabled until its applicable checks pass.
3. Define the shared coverage contract using a small test matrix: included-only sandbox, mixed included/paid sandbox, paid tool, customer-funded model. Specify identities, units, reservation/settlement and failed-outcome recovery before parallel implementation.
4. Implement independent one-time top-ups and the selected hardening work. These do not need Apollo. Implement model usage capture/versioned pricing in parallel where contracts permit, following the original work-package dependencies.
5. Add one fixed-class sandbox allowance path. Start with zero-credit included usage and a configurable stop; enable wallet overage only after reservation/recovery is proven. This is sequencing advice, not selection of the commercial default.
6. Add one verified managed provider action after Mahmoud selects the provider and action. Apollo is a candidate, not a commitment. Use whichever verified transport is simplest.
7. Add the corresponding usage display and release evidence. Release only the selected subset; leave unrelated cards open.

## What needs Mahmoud's choice

- Authorize the next implementation slice. Recommendation: shared coverage contract and foundation verification first, not every spec at once.
- Before provider-specific implementation, choose the first funded model or managed tool action. No final commercial prices are needed.
- Before real enablement, approve deployed limits/rates, included usage, overage behavior and provider terms. These are configuration choices, not reasons to block the initial contract work.

No implementation, commit, push, merge or deployment is performed by this documentation task.
