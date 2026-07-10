# Bring your own runner

Design workspace. Research and proposals only. No code has changed and no PR is open.

## The user story

A user works in Agenta Cloud, but the agent runs on their own machine. In the extreme
case, the runner is a single executable they download and start. Their code, their files,
their compute. Agenta Cloud still owns the config, the conversation, the traces, the tools,
and the approvals.

## The one-paragraph answer

The runner is already close to shippable as a standalone piece: it is a self-contained
Node package with a documented `/run` contract, and it already keeps secrets out of the
sandbox by design. The hard part is not the runner. It is the network direction. Today the
backend calls the runner (`POST /run`) over a trusted private network with no TLS and an
optional static token. Moving the runner to a user's machine flips that boundary: the
backend must reach a laptop behind NAT, carrying plaintext provider secrets in the
payload. The v0 answer is a tunnel (ngrok) plus a pairing token. The right long-term
answer is to reverse the direction: the runner dials out to the cloud and holds a
persistent connection, the way GitHub Actions self-hosted runners do. Then no inbound
port, no tunnel, and no public endpoint exist at all, and one scoped credential covers
everything.

## Files

- [report.md](report.md) - the main deliverable. Answers the five questions: which
  interfaces the runner needs, what our runner adds to sandbox-agent, the limitations of
  running on a user machine, whether we need a new API key type, and a simple proposal.
- [research.md](research.md) - the verified current state with `file:line` citations:
  the full interface map, the capability inventory, the auth audit, and the session and
  approval constraints.
- [architectures.md](architectures.md) - the solution space: two connectivity
  directions (tunnel-in vs dial-out), two packagings (bare process vs Docker), and the
  auth options, each with trade-offs.
- [plans.md](plans.md) - three plans at increasing complexity: Tier 0 (glue what
  exists, days), Tier 1 (productized pairing, weeks), Tier 2 (native dial-out runner,
  months).

## How this relates to the neighbouring projects

- [`runner-interface`](../runner-interface/README.md) - the `/run` wire contract a
  remote runner must speak. This project treats it as given.
- [`sidecar-deployment-proposal`](../sidecar-deployment-proposal/proposal.md) - §5
  already states the bar for external runners: versioned protocol, schemas, golden
  fixtures, conformance tests, capability negotiation. Tier 2 here picks that up.
- [`sidecar-trust-and-sandbox-enforcement`](../sidecar-trust-and-sandbox-enforcement/README.md)
  - landed the loopback bind and the optional `AGENTA_RUNNER_TOKEN`; deferred TLS and
  scoped tokens. A remote runner makes those deferred items load-bearing.
- [`session-keepalive`](../session-keepalive/README.md) and
  [`harness-session-resume`](../harness-session-resume/plan.md) - the session model a
  remote runner inherits. A user machine actually helps here: the harness session file
  lives on the runner's own disk, which a personal machine keeps naturally.
- [`secret-isolation`](../secret-isolation/README.md) - the reason callback tools and
  MCP headers already survive a remote runner unchanged: their secrets never leave the
  backend.
- [`subscription-sidecar`](../subscription-sidecar/README.md) - the path where the
  user's own Claude/ChatGPT login provides model auth, which fits a personal machine
  better than shipping vault keys to it.
