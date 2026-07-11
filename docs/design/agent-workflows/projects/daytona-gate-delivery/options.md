# Fix directions

Three directions can fix F-018. They are not exclusive. The recommendation combines two of
them and adds a delivery-acknowledged timeout on the file channel. Each option below
states what it changes, what it buys, and what it costs.

The finding names all three. This document evaluates them against the mechanism in
[research.md](research.md) rather than picking one by default.

## Option A: make the reverse permission RPC work over the remote transport

Diagnose why the Daytona proxy passes `session/update` notifications but drops the
`session/request_permission` server request on the same SSE stream, then fix it so the
reverse request reaches the runner.

- What it buys. One permission plane for local and Daytona. Allow, ask, and deny all work
  the same way on both. Ask surfaces a real UI prompt with no extra plumbing, because it
  reuses the existing pause and resume path. It is the cleanest end state on paper.
- What it costs. The root cause is not pinned by static analysis. It lives in the Daytona
  preview proxy's handling of a server-initiated request that expects a correlated client
  response. Confirming it needs live proxy-level inspection. Fixing it probably needs a
  change in the vendored `sandbox-agent` transport (a self-initiated reverse channel, a
  long-poll, or a websocket) or a change to how the proxy is used. That work belongs with
  the sandbox-agent fork plan (PR #5172), not a QA fix. It is the highest cost and the
  highest uncertainty of the three, and it may not be fixable on the proxy side at all.

Verdict: keep as the ideal long-term shape, reject as the primary path now. The plan does
not depend on it.

## Option B: deliver gate decisions over the file relay Daytona already polls

Stop raising the gate as a reverse RPC on Daytona. Have the extension write a
gate-request file to the relay directory and poll for a decision file. The runner's relay
loop, which already polls the sandbox filesystem on Daytona, picks up the request, runs it
through the same responder policy, and writes the decision back. For an ask gate the
runner emits the same `interaction_request` event it emits today, surfaces the UI prompt,
and writes the decision file when the human answers.

- What it buys. It sidesteps the broken reverse request entirely and reuses a channel
  already proven to work on Daytona (the custom-tool relay, see
  [research.md](research.md)). It keeps the decision on the runner, so it preserves the
  trust boundary the `pi-gate-envelope` design set. It is the only option that can surface
  a real ask prompt on Daytona without fixing the transport.
- What it costs. It builds a second permission channel next to the ACP one, so there are
  two paths to keep in sync. The extension must branch local versus Daytona. The runner
  must start the relay loop for a builtins-only run and pass the relay dir to the
  extension for builtin gating (both noted in [research.md](research.md)). Ask, pause, and
  resume across turns must be re-expressed on the file channel, which is the subtle part.

Verdict: adopt, narrowed to residual builtins (the `runner` disposition). Custom tools do
not ride this channel; the design review showed their existing execution relay request is
the cleaner authorization seam (see the recommendation below).

## Option C: resolve auto-allowed builtins in the sandbox with no round-trip

Have the runner precompute each granted builtin's decision and inject it into the sandbox
alongside the grant list. The extension then resolves an allow with no confirm and blocks
a deny with no confirm. It raises a gate only when the injected decision is ask, or when
the decision depends on the call arguments and so cannot be precomputed.

- What it buys. It removes the hang for the entire allow-mode case, which is exactly what
  the QA matrix exercises and exactly what breaks the build-kit default agent. Read and
  bash in allow mode both stop round-tripping. It is the smallest change, the lowest risk,
  and it needs no new channel. A deny also resolves in the sandbox, which is strictly
  safer than waiting.
- What it costs. It moves the allow and deny decision for builtins into the sandbox. The
  `pi-gate-envelope` design deliberately kept policy on the runner because the sandbox is
  not trusted to state its own permissions. This is a real trust-surface change and the
  plan must justify it. The justification is specific to builtins: a builtin already
  executes inside the sandbox with no runner mediation, so the gate is its only control
  point, and that gate already keys off a grant list the runner injects. Injecting the
  decision lets the extension enforce deny and ask against the model, which is the actual
  threat for a builtin (a prompt-injected model calling a tool the policy forbids). It
  does not weaken defense against a compromised sandbox, because a compromised sandbox can
  already run any builtin regardless of the gate. The argument holds for builtins. It does
  not hold for custom tools, which is why this option is scoped to builtins only and
  custom-tool decisions stay on the runner. Option C alone also cannot answer an ask gate,
  so it needs Option B for the ask case.

Verdict: adopt as the primary fix for allow and deny builtins.

## Recommendation (revised after design review)

Combine C and a narrowed B, with an acknowledged two-lifetime timeout.

1. Option C is the primary fix. The runner compiles each granted builtin's policy into a
   disposition of `allow`, `deny`, or `runner` (`runner` covers both ask and any
   argument-dependent rule) and injects the versioned map into the sandbox. Allow and
   deny resolve with no round-trip. This alone makes the failing QA scenario pass,
   because those runs use allow mode.
2. Option B is narrowed to residual builtins only. A `runner`-disposition builtin on
   Daytona raises its gate as a request file over the relay, with a runner
   acknowledgment, an authenticated decision file, and explicit cold and live resume
   paths. Custom tools do NOT get a second gate channel: their execution request already
   reaches the runner's relay guard, so that existing request becomes the authorization
   seam (allow executes, deny returns a denied result, pending pauses without
   executing).
3. The gate timeout is a two-lifetime model, not one timer: a short delivery deadline
   that ends at the runner's acknowledgment and fails closed (the F-018 case), and a
   human approval lifetime after acknowledgment owned by the existing pause model. One
   timer cannot tell an undeliverable gate from a human deliberating, and reaping a
   parked approval would break the HITL model that run-limits deliberately protects.
4. Option A stays documented as the ideal long-term shape and is deferred to the
   sandbox-agent fork plan. If A ever lands, C stays as a latency optimization and B can
   retire.

Everything ships as one release unit. Under the default `allow_reads` policy, C alone
would fix reads while bash, edit, and write still hang, which is not a shippable state.

An independent design review ([design-review.md](design-review.md)) confirmed this
direction and reshaped the details above; the disposition vocabulary, the relay-seam
custom-tool authorization, the two-lifetime timeout, the decision-file integrity, and
the resume state machines all come from that review. The interface shapes are specified
in [plan.md](plan.md), reviewed by semantic role.
