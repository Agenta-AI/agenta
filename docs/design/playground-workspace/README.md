# Playground workspace discussion

> Draft for founder and frontend review. No implementation or scope approval is implied.

Date: 2026-09-11.

The proposal turns the agent playground into one or two panes with movable tabs. A conversation, file, explorer, or application can occupy either pane.

Read [the product requirements document](prd.md) for the intended experience, then [the initial request for comments](rfc.md) for the architecture and tradeoffs. Both are deliberately high level. There is no implementation schedule or final interface contract.

Related: [PR #6529: workspace-backed internal HTML apps](https://github.com/Agenta-AI/agenta/pull/6529). That proposal covers executing HTML and granting file access. This proposal covers presenting those apps alongside conversations and files.

Terms used in these documents:

- A resource is an underlying session, file, application, or remote computer.
- A tab is an open view of a resource.
- A pane holds ordered tabs and displays its selected tab.
- A workspace stores the panes, open tabs, and keyboard focus for an agent's playground.
- A runtime is a live client object, such as a chat connection, whose lifetime can outlast its React view.
- A sandbox is the isolated environment where an agent runs tools or applications.

Status: initial discussion drafts. The founder requested the split-pane direction and the candidate content types. The proposed first scope, lifecycle policies, and library preference are agent suggestions awaiting review.
