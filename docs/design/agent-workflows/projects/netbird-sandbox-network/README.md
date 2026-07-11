# NetBird sandbox overlay network

Research and effort assessment for one idea: put the runner and its Daytona sandboxes on a
shared private WireGuard mesh (an overlay network) using NetBird, so the runner and a sandbox
can open connections to each other in both directions. That would attack a whole class of
connectivity problems at once, instead of one workaround per feature, and could carry MCP
traffic later. Includes a side assessment of Cloudflare Tunnel as a near-term, zero-auth
replacement for the ngrok store tunnel.

This is research only. No code changed. Owner: Mahmoud.

## The problem it targets

Today the runner reaches a Daytona sandbox one way (the Daytona signed preview URL). The
sandbox has no direct way back to the runner; it only writes files the runner polls. That
missing return direction is the root cause behind three separate workarounds:

- **F-017:** a remote sandbox cannot reach the runner-side store, so mounts go through a
  public ngrok tunnel (`../qa/findings.md`,
  `services/runner/src/engines/sandbox_agent/mount.ts`).
- **F-018:** the reverse permission RPC from sandbox to runner never arrives, so gate
  decisions are being routed through polled files instead (`../daytona-gate-delivery/`).
- **MCP delivery:** the runner's tool-MCP server binds a loopback the sandbox cannot reach,
  so it is skipped on Daytona and an in-sandbox shim is planned
  (`../mcp-delivery-architecture/directions.md`).

A shared overlay would give the sandbox a direct, private route back to the runner, which is
the one thing all three lack.

## Files (reading order)

- [plan.md](plan.md) — start here: the whole sandbox network story in one place. The four
  problems as they exist today, the near-term Cloudflare quick-tunnel step, the longer-term
  NetBird overlay phases, which workarounds retire in which order, local mode and
  self-hosters, and the sequencing against the work in flight.
- [research.md](research.md) — the five research questions answered with sources
  (feasibility inside a Daytona sandbox, architecture, security and tenancy, local mode,
  effort and alternatives), plus the Cloudflare Tunnel assessment.
- [recommendation.md](recommendation.md) — the verdict, the one-day confirmation run, phase
  estimates, and the Cloudflare quick-tunnel call.

## Glossary

- **Overlay network.** A virtual private network on top of the internet. Peers get private
  addresses and reach each other by them, wherever they run. WireGuard does the encryption.
- **Peer.** One machine on the overlay (the runner; each sandbox).
- **TUN device.** A kernel virtual network interface at `/dev/net/tun`. Kernel-mode WireGuard
  creates one for transparent routing; it needs the `NET_ADMIN` capability.
- **Userspace mode (netstack).** WireGuard entirely inside one process, own TCP/IP stack, no
  TUN, no `NET_ADMIN`. Not transparent: it proxies specific ports rather than routing all
  traffic.
- **Management plane.** NetBird's control service: registers peers, holds the network map,
  distributes access policy. Separate from the data path; peer traffic does not flow through
  it.
- **Setup key.** A token a headless machine uses to join the overlay with no human login. Can
  be reusable and ephemeral (auto-removed when the peer goes offline).

## One-line verdict

Feasible and documented: Daytona's docs support NetBird inside sandboxes as a first-class
flow with setup-key join, and their OpenVPN flow shows TUN devices exist, so kernel mode is
the design basis. One short confirmation run in our stack (join, both directions, latency,
egress-policy interaction), then it is a prioritization decision. Near term, adopt
Cloudflare quick tunnels for the store mount path to remove the ngrok token requirement. See
[recommendation.md](recommendation.md).
