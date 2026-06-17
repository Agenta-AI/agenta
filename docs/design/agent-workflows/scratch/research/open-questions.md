# Agent Workflows: Daytona and pi.dev due-diligence

Status: research only. Broad due-diligence to surface what the focused research topics
(interaction API, OTel instrumentation, sandbox creation, auth/secrets, sandbox-sharing)
might miss. Every claim is cited. Items I could not verify from a primary source are
marked UNVERIFIED. Researched 2026-06-15.

## Summary

- **pi.dev** is a young but very active open-source (MIT) agent harness from Earendil Inc.,
  authored by Mario Zechner (GitHub `badlogic`, creator of libGDX). The npm package
  `@earendil-works/pi-coding-agent` first published 2026-05-07 and is on **0.79.4** (released
  the day of this research), shipping roughly weekly with frequent **breaking changes** in
  the 0.x line. It runs locally as a CLI/SDK/RPC server; **it does not depend on Daytona**.
- **Daytona** is a mature, well-funded ($5M, Upfront Ventures), SOC-2 open-source (AGPL-3.0)
  sandbox platform for running AI-generated code. Sub-90ms container starts, usage-based
  pricing, $200 free credits, US/EU regions. The managed cloud is the same codebase as the
  OSS repo and can be self-hosted via Docker Compose.
- **Biggest risks for this project:** (1) pi's 0.x velocity and breaking changes mean we
  pin a version and budget for upgrade churn; the RPC/SDK contract is pi-specific and
  **not** a portable cross-harness standard, so "configurable harness" is an abstraction
  *we* own. (2) pi has **no first-party OpenTelemetry**; the only OTel path today is a
  third-party community extension. (3) Daytona uses shared-kernel containers (not microVMs),
  a weaker isolation story for hostile code; (4) default **15-min auto-stop** can kill
  long-running agents mid-run; (5) network egress is restricted by default below Tier 3.

## Maturity & risk

**pi.dev**
- Open source, **MIT** license; monorepo `earendil-works/pi` (mirror/origin also seen as
  `badlogic/pi-mono`). Packages: `pi-coding-agent` (CLI), `pi-agent-core` (runtime, tool
  calling, state), `pi-ai` (unified multi-provider LLM API), `pi-tui` (terminal UI). A
  separate `pi-chat` repo does Slack/chat workflows.
  [README](https://github.com/earendil-works/pi/blob/main/README.md),
  [npm](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- Author: **Mario Zechner** (`badlogic`), an experienced OSS developer (libGDX). Earendil Inc.
  is the company.
  [HN](https://news.ycombinator.com/item?id=46629341),
  [GitHub badlogic](https://github.com/badlogic)
- **Very young, very active.** npm package created **2026-05-07**, latest **0.79.4** on
  **2026-06-15**. Release cadence is ~weekly (0.75.0 2026-05-17 through 0.79.4 2026-06-15 =
  ~15 releases in a month). Still firmly **pre-1.0**.
  [npm metadata via `npm view`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent),
  [CHANGELOG](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md)
- **Breaking-change history is real and frequent** (0.x). Recent examples from the changelog:
  0.75.0 raised min Node to 22.19.0 and reworked tool selection from cwd-bound instances to
  tool-name allowlists; 0.72.0 replaced `compat.reasoningEffortMap` with `thinkingLevelMap`;
  0.71.0 removed built-in Gemini/Antigravity providers; 0.69.0 migrated TypeBox and
  invalidated captured session-bound extension objects. A `legacy-node20` dist-tag (0.74.2)
  exists for older Node.
  [CHANGELOG](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md)
- **Lock-in:** low at the model layer (15+ providers, MIT). But the integration surface
  (RPC commands/events, extension API, session JSONL format) is **pi-specific** and changes
  between minor versions, so coupling to pi is a real cost even though the code is open.
- Community size: hard to quantify; active HN presence, third-party extensions appearing
  (otel, sandboxing, oh-my-pi fork). Smaller and newer than Claude Code / Codex ecosystems.
  [HN](https://news.ycombinator.com/item?id=47634337)

**Daytona**
- Open source, **AGPL-3.0**; repo `daytonaio/daytona` reports ~72k stars on the repo page
  (other sources cite ~21k — figure is noisy, treat as "large, popular"). 200+ releases,
  latest ~v0.187.0 (2026-06-11). Polyglot (TS/Go/Python/Ruby/Java SDKs).
  [GitHub](https://github.com/daytonaio/daytona),
  [stars/funding search](https://www.daytona.io/dotfiles/daytona-secures-5m-to-simplify-development-environments)
- Company: Ivan Burazin (CEO, ex-Codeanywhere/Infobip), raised **$5M** (Upfront Ventures,
  500 EE). **SOC-2** compliant.
  [PRNewswire](https://www.prnewswire.com/news-releases/daytona-secures-5m-to-simplify-development-environments-302181407.html)
- **AGPL note:** the AGPL-3.0 license is copyleft and network-triggered. We consume Daytona
  as a hosted service or via SDK over the network (not by linking/modifying its source), so
  AGPL obligations should not reach Agenta's own code, but legal should confirm before any
  self-host-and-modify path. The cloud and OSS share a codebase, so self-hosting is a real
  fallback (Docker Compose stack + customer-managed compute/BYOC).
  [GitHub](https://github.com/daytonaio/daytona)

## Pricing & limits

**Daytona** (managed cloud, pay-as-you-go, no minimum/commitment):
- vCPU **$0.0504/h**; RAM **$0.0162/h per GiB**; storage **$0.000108/h per GiB** (first 5 GiB
  free). Billed per second. GPU: H100 $3.95/h, RTX PRO 6000 $3.03/h. Windows/Android OS
  add-ons extra. **$200 free credits** at signup (no card for trial); startups up to $50k.
  [Pricing](https://www.daytona.io/pricing),
  [pricing search](https://www.morphllm.com/comparisons/daytona-alternative)
- **Cost intuition:** a 1 vCPU / 2 GiB sandbox ≈ $0.0504 + 2×$0.0162 = **~$0.083/h** of
  active compute (storage extra). 10 such sandboxes running continuously ≈ **$0.83/h** ≈
  ~$600/mo if never stopped; auto-stop after idle cuts this sharply since CPU/RAM stop
  billing while stopped (storage persists). Costs scale with concurrency × active runtime,
  not request count. (Derived from the per-hour rates above — arithmetic ours.)
- **Rate limits (per minute, by tier):** Tier1 10k general / 300 create / 10k lifecycle;
  Tier2 20k/400/20k; Tier3 40k/500/40k; Tier4 50k/600/50k; Enterprise custom.
- **Resource quotas (per tier):** Tier1 10 vCPU / 20 GiB RAM / 30 GiB disk; Tier2
  100/200/300; Tier3 250/500/2000; Tier4 500/1000/5000. Concurrency is gated by these
  pooled quotas (how many sandboxes run at once depends on each one's size).
- **Tier gating:** Tier1 email-verified; Tier2 card + $25 top-up; Tier3 $500 top-up; Tier4
  $2000 top-up / 30 days; Enterprise contact.
  [Limits](https://www.daytona.io/docs/en/limits/),
  [DeepWiki quotas](https://deepwiki.com/daytonaio/daytona/6.3-resource-quotas-and-limits)

**pi.dev**
- The harness itself is free/MIT. Cost is the **LLM provider tokens** (BYO key or OAuth to
  Claude Pro/Max, ChatGPT/Codex, Copilot, plus API-key providers) plus whatever sandbox you
  run it in. No pi-side metering.
  [providers search](https://hochej.github.io/pi-mono/coding-agent/rpc/),
  [pi.dev](https://pi.dev/)

## Operational concerns

**Daytona**
- **Cold start:** advertised sub-90ms sandbox creation (container-based).
  [docs overview](https://www.daytona.io/docs), [vstorm](https://oss.vstorm.co/blog/daytona-sub-90ms-code-execution/)
- **Lifecycle/timeouts:** default **auto-stop after 15 min** of inactivity, **auto-archive
  after 7 days** stopped; auto-delete configurable. Stopped = storage kept, CPU/RAM freed;
  archived = no quota. **Sharp edge:** a long-running process (e.g. a >15-min agent run with
  no external interaction) can be auto-stopped mid-run because the process itself does not
  count as "activity" — set/extend auto-stop for long agents.
  [lifecycle search](https://www.zenml.io/blog/e2b-vs-daytona),
  [Northflank](https://northflank.com/blog/daytona-vs-modal)
- **Regions / residency:** shared regions **US** (`us`) and **EU** (`eu`); you can target a
  region per sandbox. Custom Regions (BYO runners, full isolation, residency control) are
  invite-only/experimental. Some sources note the **managed cloud is effectively single
  primary region (us-east-1/iad1)** in practice — UNVERIFIED against official docs, treat
  EU availability as "claimed, confirm before relying on it for residency".
  [Regions](https://www.daytona.io/docs/en/regions/),
  [single-region claim](https://www.zenml.io/blog/e2b-vs-daytona)
- **Networking egress:** per-sandbox network stack with firewall. **Tier 1 & 2: restricted
  egress by default; Tier 3 & 4: full internet by default.** Controls: `networkAllowList`
  (CIDR, max 10 /32 entries) and `networkBlockAll`. Only Tier 3/4 can change firewall after
  creation. All tiers get allowlisted access to npm/PyPI, Docker/k8s registries,
  GitHub/GitLab, CDNs, and AI providers (Anthropic/OpenAI/Google). **Implication:** to inject
  an arbitrary secret endpoint or call a non-allowlisted internal service, plan for Tier 3+.
  [Network limits](https://www.daytona.io/docs/en/network-limits/),
  [egress issue](https://github.com/daytonaio/daytona/issues/3357)
- **Isolation:** container with dedicated kernel claims, but multiple comparisons note it
  shares the host kernel (not Firecracker microVM) — weaker boundary for genuinely hostile
  code than E2B/Fly.
  [morphllm](https://www.morphllm.com/comparisons/daytona-alternative)

**pi.dev**
- Runs as a local process; operational profile (cold start, scaling) is whatever sandbox/
  host we run it on. No managed pi runtime to scale or rate-limit. Reliability is a function
  of (a) pi's own stability at 0.x and (b) the chosen LLM provider's limits.

## Local parity

- **Strong yes — pi is local-first and needs no Daytona.** pi is a CLI/SDK/RPC harness that
  runs in any project directory. Four surfaces: interactive TUI, print/JSON event-stream
  mode, **RPC mode** (JSONL over stdin/stdout), and a **Node SDK** (`AgentSession`). The same
  binary/SDK runs locally or inside a sandbox.
  [docs index](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/index.md),
  [RPC docs](https://pi.dev/docs/latest/rpc)
- This makes "pull config from server, run the same harness locally" realistic: the agent
  config (AGENTS.md, skills, model, tools, files) maps onto pi's own context model
  (AGENTS.md/SYSTEM.md, skills, tool allowlists, presets/extensions).
  [overview](https://pi.dev/), [docs index](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/index.md)
- **What differs local vs sandboxed (the parity gaps we own):**
  - **Sandbox/isolation layer.** Server runs pi inside Daytona; local runs pi on the host (or
    pi's own local sandbox options: **Gondolin** QEMU micro-VM, plain Docker, OpenShell).
    These are pi's *own* local isolation, not Daytona — so the file/secret startup hooks and
    the FS/network surface differ between Daytona and a local run unless we replicate them.
    [containerization search](https://github.com/pasky/pi-gondolin)
  - **Secrets/auth injection.** Server injects secrets via startup hooks into the sandbox;
    locally the user supplies keys/OAuth. Parity requires our wrapper to lay down the same
    files/env both places.
  - **Network egress.** Daytona's tiered firewall has no local equivalent; a tool that works
    locally could be blocked in-sandbox below Tier 3.
  - **Instrumentation.** OTel is an opt-in extension either way (see below); it is not on by
    default, so parity depends on us loading the same extension/config in both modes.
- Net: pi gives genuine local parity for the *agent loop*; the *environment* (sandbox,
  secrets, egress, telemetry) is the part Agenta must make identical across local and server.

## Harness swappability

- **Important framing:** in pi, "harness" means *the agent loop you customize within pi*
  (tools, prompts, auth, event loop), not a pluggable adapter where you drop in Codex or
  Claude Code behind a common interface. pi's own docs/talks define the harness as "the set
  of abstractions which transforms [the] IO machine into an 'agent'" and emphasize
  composition *within* pi, not interchangeable backends.
  [harness-engineering slides](https://dmg-egg.github.io/slides-harness-engineering-with-pi/)
- pi supports many **models/providers** (Anthropic, OpenAI, Google, Bedrock, Mistral, xAI,
  Groq, Cerebras, OpenRouter, Ollama, etc.) and **subscription OAuth** to Claude Pro/Max,
  ChatGPT/Codex, and Copilot. But these are *models behind pi's loop*, not separate harnesses
  like the Claude Code CLI or Codex CLI.
  [providers/RPC search](https://hochej.github.io/pi-mono/coding-agent/rpc/)
- The RPC protocol is rich (85+ commands, ~12 event types incl. `agent_start/end`,
  `turn_start/end`, `message_*`, `tool_execution_*`, plus `get_state` exposing `sessionId`,
  and `agent_end` carrying **all messages from the run** = the multi-message output). But it
  is **pi-specific and unversioned** (no documented stability/deprecation policy), and pi's
  own docs say to prefer `AgentSession` directly over the subprocess RPC when embedding in
  Node. So it is a good integration surface for pi, **not** a neutral cross-harness standard.
  [RPC docs](https://pi.dev/docs/latest/rpc)
- **Conclusion for the design:** "configurable/swappable harness" is **an abstraction Agenta
  must own.** If we ever want to run Codex CLI or Claude Code as alternative harnesses, we
  define our own port (config in -> sandbox setup -> run -> normalized multi-message output +
  session_id + traces out) and write per-harness adapters. pi will be the first and
  best-fitting adapter because of its RPC/SDK, but it does not hand us a ready-made
  multi-harness interface.

## Gotchas / sharp edges

- **pi 0.x churn.** Weekly releases with breaking changes (Node-version bumps, tool-selection
  model changes, provider removals, session-object invalidation). Pin an exact version, test
  upgrades, watch the changelog.
  [CHANGELOG](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md)
- **No first-party OTel in pi.** The only OpenTelemetry path is a **third-party community
  extension** (`mprokopov/pi-otel-telemetry`), which emits one trace tree per prompt (turns,
  LLM requests, tool calls) over OTLP. It is unofficial and unversioned against pi; the
  instrumentation research topic should treat first-party telemetry as absent today.
  [pi-otel repo](https://github.com/mprokopov/pi-otel-telemetry),
  [pi-otel writeup](https://nikiforovall.blog/ai/productivity/2026/05/16/pi-otel.html)
- **pi has no built-in permission system / MCP / sub-agents / plan mode** by design — they
  are extension territory. Anything we assume "the agent will ask before X" must be added.
  [README](https://github.com/earendil-works/pi/blob/main/README.md),
  [docs index](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/index.md)
- **JSONL framing is strict** in RPC mode: split on `\n` only; do not use Node `readline`
  (it splits on Unicode separators too) or records corrupt.
  [RPC search](https://hochej.github.io/pi-mono/coding-agent/rpc/)
- **Daytona 15-min auto-stop** can kill long agent runs mid-flight (process activity does not
  reset the idle timer) — set auto-stop explicitly for agents.
  [lifecycle search](https://www.zenml.io/blog/e2b-vs-daytona)
- **Daytona egress is tiered**; below Tier 3 you cannot freely reach arbitrary endpoints and
  cannot change the firewall post-creation. Budget for Tier 3 if agents call internal/custom
  services.
  [Network limits](https://www.daytona.io/docs/en/network-limits/)
- **Daytona shared-kernel isolation** is weaker than microVM competitors for untrusted code.
  [morphllm](https://www.morphllm.com/comparisons/daytona-alternative)
- **pi.dev's own sandbox examples (Gondolin/Docker/OpenShell) are local/host-side**, with no
  first-party Daytona integration — the pi <-> Daytona glue is ours to build.
  [containerization search](https://github.com/pasky/pi-gondolin)

## Alternatives (fallback landscape — one line each)

Sandbox providers (alternatives to Daytona):
- **E2B** — Firecracker microVM with a dedicated kernel per sandbox; strongest isolation for
  untrusted code.
  [morphllm](https://www.morphllm.com/comparisons/daytona-alternative)
- **Modal** — native GPU sandboxes; the pick when agents need inference/GPU in-sandbox.
  [morphllm](https://www.morphllm.com/comparisons/daytona-alternative)
- **Fly.io (Machines / "Sprites")** — full filesystem persistence across sessions so agents
  resume without rebuilding; Firecracker-based.
  [morphllm](https://www.morphllm.com/comparisons/daytona-alternative)
- **Morph** — VM branching/fork in <250ms for parallel exploration of multiple solution paths.
  [morphllm](https://www.morphllm.com/comparisons/daytona-alternative)
- **Freestyle** — full root + nested virtualization (Docker-in-VM) for heavy/custom envs.
  [morphllm](https://www.morphllm.com/comparisons/daytona-alternative)
- **Vercel Sandbox / Northflank / Cloudflare / microsandbox** — other credible options that
  show up in 2026 comparisons; differentiators not deeply verified here. UNVERIFIED specifics.
  [comparison](https://northflank.com/blog/ai-sandbox-pricing),
  [comparison](https://betterstack.com/community/comparisons/best-sandbox-runners/)

Harnesses (alternatives to pi.dev):
- **Claude Code** (Anthropic) — the de-facto reference coding agent; more opinionated, larger
  ecosystem, less "minimal/composable" than pi. Often cited by pi users as the thing they
  came from.
  [HN](https://news.ycombinator.com/item?id=47634337)
- **Codex CLI** (OpenAI) — OpenAI's agent CLI; pi can use Codex *as a provider via OAuth*, but
  as a *harness* it's a separate tool with its own loop.
  [providers search](https://hochej.github.io/pi-mono/coding-agent/rpc/)
- **oh-my-pi** — a community fork of pi adding subagents/LSP/browser/optimized tool harness;
  signal that pi's design invites forks, and a possible drop-in if pi mainline diverges.
  [oh-my-pi](https://github.com/can1357/oh-my-pi)

## Open questions (for the focused topics / before committing)

1. Pin strategy for pi version (exact pin + upgrade cadence) given weekly breaking 0.x
   releases. Who owns watching the changelog?
2. Telemetry: do we adopt/fork `pi-otel-telemetry`, or write our own pi extension to emit the
   spans Agenta tracing expects? (No first-party OTel exists.) → instrumentation topic.
3. Confirm Daytona EU region + data-residency guarantees against official docs/sales; the
   "single-region us-east-1" claim needs verification before we promise EU residency.
4. Decide the default auto-stop / max-run-duration for agent sandboxes so long runs aren't
   killed at 15 min. → sandbox-creation topic.
5. Which Daytona tier do we operate on? Egress + post-creation firewall + concurrency quotas
   all hinge on Tier 3+. → auth/secrets + sandbox-creation topics.
6. Define Agenta's own harness port (config -> setup -> run -> normalized output + session_id
   + traces) since pi gives no neutral multi-harness interface; validate it against pi first,
   then sketch a Codex/Claude-Code adapter to prove the abstraction. → pi.dev harness topic.
7. Local-parity contract: which startup hooks (files, secrets, egress, telemetry) must be
   replicated locally, and do we reuse pi's Gondolin/Docker locally or run bare on host?
   → local-execution topic.
8. AGPL review for any self-hosted-and-modified Daytona path (network copyleft).

## Sources

- pi.dev overview — https://pi.dev/
- pi README — https://github.com/earendil-works/pi/blob/main/README.md
- pi docs index — https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/index.md
- pi coding-agent CHANGELOG — https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md
- pi npm package — https://www.npmjs.com/package/@earendil-works/pi-coding-agent
- pi RPC docs — https://pi.dev/docs/latest/rpc
- pi RPC (mirror) — https://hochej.github.io/pi-mono/coding-agent/rpc/
- Harness engineering with pi (slides) — https://dmg-egg.github.io/slides-harness-engineering-with-pi/
- Mario Zechner GitHub — https://github.com/badlogic
- HN discussion on pi — https://news.ycombinator.com/item?id=47634337 and https://news.ycombinator.com/item?id=46629341
- pi-otel telemetry extension — https://github.com/mprokopov/pi-otel-telemetry
- pi-otel writeup — https://nikiforovall.blog/ai/productivity/2026/05/16/pi-otel.html
- pi-gondolin sandbox extension — https://github.com/pasky/pi-gondolin
- oh-my-pi fork — https://github.com/can1357/oh-my-pi
- Daytona docs overview — https://www.daytona.io/docs
- Daytona limits — https://www.daytona.io/docs/en/limits/
- Daytona resource quotas (DeepWiki) — https://deepwiki.com/daytonaio/daytona/6.3-resource-quotas-and-limits
- Daytona regions — https://www.daytona.io/docs/en/regions/
- Daytona network limits — https://www.daytona.io/docs/en/network-limits/
- Daytona dynamic egress issue — https://github.com/daytonaio/daytona/issues/3357
- Daytona pricing — https://www.daytona.io/pricing
- Daytona GitHub — https://github.com/daytonaio/daytona
- Daytona funding (PRNewswire) — https://www.prnewswire.com/news-releases/daytona-secures-5m-to-simplify-development-environments-302181407.html
- Daytona funding (blog) — https://www.daytona.io/dotfiles/daytona-secures-5m-to-simplify-development-environments
- E2B vs Daytona — https://www.zenml.io/blog/e2b-vs-daytona
- Daytona vs Modal — https://northflank.com/blog/daytona-vs-modal
- AI sandbox pricing comparison — https://northflank.com/blog/ai-sandbox-pricing
- Daytona alternatives — https://www.morphllm.com/comparisons/daytona-alternative
- Sandbox runners comparison — https://betterstack.com/community/comparisons/best-sandbox-runners/
- Daytona sub-90ms (vstorm) — https://oss.vstorm.co/blog/daytona-sub-90ms-code-execution/
