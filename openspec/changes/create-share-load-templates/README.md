# Create, share and load templates

Design and delivery scope approved on 2026-09-26. This change contains planning documents only. No implementation task is complete. Marketplace website UI designs will be supplied separately by Mahmoud.

## Read first

1. [Handoff](HANDOFF.md): where the next agent starts, existing code, checks, and UI dependencies.
2. [Proposal](proposal.md): user outcomes and scope.
3. [Design](design.md): architecture and trade-offs.
4. [API contract](api-design.md) and [metadata](metadata.md): proposed interfaces.
5. [Delivery tasks](tasks.md): one progress checklist across the three workstreams.
6. Implementation plans: [catalog and metadata](plans/01-catalog-and-metadata.md), [create and load](plans/02-create-and-load.md), and [marketplace](plans/03-marketplace.md).
7. [Evidence](evidence.md): checked repository baseline and limits of the research.

## Behavioral specifications

- [Export](specs/template-export/spec.md)
- [Upload and session-file loading](specs/template-upload-loading/spec.md)
- [GitHub loading](specs/template-github-loading/spec.md)
- [Catalog API](specs/template-catalog-api/spec.md)
- [In-app gallery](specs/app-template-gallery/spec.md)
- [Submission](specs/marketplace-submission/spec.md)
- [Website](specs/website-marketplace/spec.md)

These requirements extend the implemented single-agent loader. They do not mark the older [single-agent change](../load-single-agent-templates/proposal.md) as complete or replace its baseline. Package format and loader constraints continue to apply.

## Decision boundary

The simplifications are approved: validate exported zips, require full GitHub commits, use one Python catalog reader, migrate bundled catalog/API/frontend together, omit a custom catalog-root setting, validate all packages in CI, and separate website work from import/export dependencies. Exact new symbols and file names in the plans are implementation proposals. Reconcile them with current code before adding files.

The new catalog envelope replaces the bundled unwrapped file in the same release. It does not need a legacy reader. This is not permission to discard exported package schema checks, published package versions, existing installed agents, or load-request retry safeguards.
