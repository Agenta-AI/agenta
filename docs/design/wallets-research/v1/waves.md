# Wallet research: checkpoint and wave workflow

This is the delivery model for the wallet work. It keeps design, implementation, testing, and review
out of chat-only memory.

## Checkpoints and waves

Work moves from checkpoint `K-1` to checkpoint `K`. The work needed to reach that target is **Wave
K**. A wave is not named or numbered before both checkpoints and its target are explicit.

Each wave proceeds in this order:

1. Close the design gate: specifications, invariants, testable examples, and explicit non-goals.
2. Break the work into a dependency graph of independently executable nodes.
3. Implement the graph through independent worktrees and throwaway branches.
4. Locally deploy the completed final merge; run integration and acceptance tests there.
5. Review the deployed result, close the wave in conversation, and prepare the next checkpoint.

## Node types

| Node | Meaning | Branch/worktree | Testing and review |
| --- | --- | --- | --- |
| CU | Cleanup work needed before, during, or after the feature work. | Its own independent worktree and throwaway branch. | Unit tests where relevant; reviewed when merged through an IM. |
| WP | A focused work package that can proceed independently once its dependencies are met. | Its own independent worktree and throwaway branch. | Unit tests may run in the WP. |
| IM | An intermediate merge / fan-in point for one or more completed WPs or CUs. | Its own independent worktree and throwaway branch. | Every IM is reviewed. |

The graph can fan out into parallel WPs and fan in through IMs repeatedly. The final IM, followed by
any final CU, is the deployment node. The user performs the local deployment; integration and
acceptance tests run there, not as a prerequisite of every WP. Unit tests remain appropriate in WPs.

## Current status

The relational/lifecycle wallet foundation is checkpoint 0. Wave 1 is planned to reach checkpoint 1;
its graph and per-node specifications/tasks are in [wave-1.md](wave-1.md). Gateway measurements, raw
metrics, and charge calculation are gateway-owned; the wallet receives a gateway-decided debit command.
The selected direction is a two-stream Redis chain: `streams:measurements` feeds the measurement worker
and `streams:debits` feeds the wallet worker. Existing ACP `records` keeps its name. The Wave 1 slice
uses fake built-in LLM and MCP gateways. It is planning only until its graph/specification review closes.
