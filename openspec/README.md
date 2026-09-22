# Repository specifications

## Railway preview cost controls

[Proposal](changes/railway-preview-cost-controls/proposal.md), [behavior specifications](changes/railway-preview-cost-controls/specs/railway-preview-lifecycle/spec.md), [PR comment command](changes/railway-preview-cost-controls/specs/railway-preview-comments/spec.md), [design](changes/railway-preview-cost-controls/design.md), and [tasks](changes/railway-preview-cost-controls/tasks.md).

Implemented in PR #7058. Delete automatic previews after tests and let authorized maintainers request a one-hour preview with a `/preview` comment on the pull request. See [validation status and limits](changes/railway-preview-cost-controls/validation.md) before treating provider acceptance or default-branch activation as complete.

## Agent template specifications

These OpenSpec changes are proposals for PR #6944. No runtime implementation is included, and no change has been archived as a shipped capability.

Start with [the single-agent proposal](changes/load-single-agent-templates/proposal.md), then [its design](changes/load-single-agent-templates/design.md). The four capability specifications cover [sources](changes/load-single-agent-templates/specs/template-sources/spec.md), [loading](changes/load-single-agent-templates/specs/single-agent-template-loading/spec.md), [first-message delivery](changes/load-single-agent-templates/specs/template-first-message/spec.md), and [existing entry behavior](changes/load-single-agent-templates/specs/template-entry-behavior/spec.md).

The separate [subagent proposal](changes/support-template-subagents/proposal.md) is deferred and NOT IMPLEMENTED.

Validate document structure from the repository root with OpenSpec 1.13.1:

```sh
openspec validate --all --strict --no-interactive
```

This validates specification format only. Runtime acceptance requires the scenario evidence described in [the validation plan](../docs/design/agent-workflows/projects/agent-plugin-templates/validation.md). Implementation tasks remain unchecked.
