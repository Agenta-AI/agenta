Simplify

Intent

Help a small engineering team keep a large product understandable and changeable.
Look for ways to remove obligations: less behavior to support, fewer things to keep
in sync, and fewer places a future change can go wrong. A useful simplification
makes the next feature, diagnosis, or handover easier.

Optimize for the total burden on maintainers and users. A shorter implementation
that hides control flow or pushes recovery work onto users can increase that burden.
A few explicit lines, a well-placed boundary, or a necessary invariant can make the
system simpler even when the line count grows.

These are directions for judgment, not a sequence to execute or a quota of findings.
Use whichever considerations matter to the task. Sometimes the best recommendation
is to keep a design as it is.

Scope is usually the biggest lever

Separate the user's desired outcome from the mechanism proposed to achieve it.
A request for reliable completion does not by itself require a general workflow
engine. A need to prevent overlapping edits may be satisfied by refusing the second
edit rather than supporting a queue, merge, and conflict-resolution policy.

Consider which capability, mode, configuration option, compatibility promise, or
combination of features creates most of the complexity. A narrower, explicit
contract can remove entire branches of implementation and testing. Name what users
would give up and whether anyone currently relies on it. Propose changes to existing
product promises; do not silently remove them during a refactor.

Distinguish a present requirement from an anticipated one. An extension point,
plugin system, alternate transport, or scaling mechanism needs a concrete consumer
or constraint. When deferring it, identify what evidence would make it worth adding
and whether adding it later would actually be difficult. Preserve inexpensive
boundaries that make change easy without implementing every imagined future.

For public software, check the supported deployment and client contracts. The
maintainers' own deployment is not evidence that other supported modes are unused.
An unused internal helper and a published API carry different removal costs.

Choose which edge cases deserve machinery

Judge a case by its credible trigger, frequency, consequence, and recovery cost.
Use actual callers, deployments, incidents, or a concrete execution path. Do not
invent numerical probabilities or build recommendations around chains of unlikely
coincidences. A merely possible scenario is not automatically worth a new subsystem.

Timeouts, restarts, duplicate delivery, and interrupted requests are ordinary
conditions in systems that cross process or network boundaries. Data loss,
authorization failures, and irreversible side effects can deserve a simple guard
even when uncommon. Simplification should preserve the invariants that protect
people's work.

Often the useful choice is to make a case unsupported or impossible: reject an
ambiguous request, require one owner, bound concurrency, or accept a documented
limit. Where failure is recoverable and visible, an explicit error and retry may be
simpler than automatic repair. Where a failed attempt may already have changed
something, retry needs an account of that side effect.

Prefer removing a class of failures over adding another special-case handler. Ask
what constraint would make the problematic state unreachable.

Give the system fewer things to coordinate

Look for facts stored in several places, independently updated flags, competing
owners, and state that can be derived from an authoritative value. Each copy creates
an obligation to synchronize, invalidate, and repair it. A cache may earn that cost
through a measured need; otherwise deriving the value can remove the obligation.

Consider whether related changes can share one transaction or one owner. Whether a
response can carry information that currently requires a callback. Whether one layer
can own retries instead of several multiplying them. Whether an existing component
can do the job without another service, queue, scheduler, or deployment dependency.
These are candidates, not bans: asynchronous work and separate services may satisfy
real lifetime, isolation, or throughput requirements.

A good boundary hides a coherent responsibility behind a small contract. A boundary
that only forwards arguments or renames the same fields may add navigation without
reducing what callers need to understand. Judge an abstraction by the detail it
removes from its users, not by how many implementations it could support someday.

Include operations in the comparison. A design with fewer source files can still
require more configuration, credentials, migrations, monitoring, and recovery
procedures. Prefer a system whose behavior can be explained from a request through
to its durable effects without reconstructing several implicit protocols.

Seek elegance in the model and the code

Look for a representation that makes the rules obvious. A small set of explicit
states may replace interacting booleans. One canonical identity may remove repeated
matching and fallback logic. Normalizing input at a real boundary may remove the
same defensive checks from every consumer. Preserve validation where trust changes.

Prefer ordinary control flow, meaningful names, and cohesive functions. Extract a
helper when it gives a concept a useful name or hides detail the caller should not
manage. Inline a helper when following it adds more work than reading its body.
Neither function length nor file count decides this alone.

Share knowledge that must change together. Similar-looking code that represents
different policies may be cheaper to keep separate. If a shared abstraction collects
mode flags and exceptions for every caller, splitting it can remove more complexity
than further generalizing it. Avoid both copied business rules and forced reuse.

Look for code whose reason to exist has disappeared: completed rollout branches,
obsolete adapters, redundant conversions, and wrappers with no remaining policy.
Check consumers and compatibility before recommending deletion. Carry useful tests
forward around observable behavior and important invariants; remove tests that only
enshrine deleted plumbing. Do not replace removed code with a larger framework or a
forest of mocks merely to preserve the old shape.

Make the suggestion worth acting on

Understand what the current design accomplishes and why it has its present shape
before judging it. Ground each recommendation in a specific responsibility,
contract, state, or code path. Explain what could disappear, why the remaining
system is easier to reason about, and what behavior or tradeoff changes.

Prefer a few substantial suggestions to a long list of stylistic nits. Label design
alternatives and maintainability improvements as Suggestion (non-blocking).
Reserve stronger findings for concrete, significant correctness or reliability
problems, with a reachable trigger and impact. Separate demonstrated failures from
hypotheses and identify what still needs verification.

When reviewing, remain in review mode unless asked to implement. Posting findings
requires the user's authorization. When implementing, favor a narrow change whose
behavior can be checked over a wholesale rewrite. Consider the cost of migration,
compatibility, and temporary coexistence alongside the eventual reduction in code.
A cleanup that takes weeks to repay may be less useful than deleting one unnecessary
mode today.

A useful suggestion might say: "These two status fields describe the same lifecycle
but are updated independently. Deriving the badge from the existing status would
remove the synchronization effect and its stale-state path. This is appropriate if
the badge has no separate lifecycle requirement." It names a deletion and its
condition without treating one pattern as universally wrong.

Supporting ideas

The guidance above is self-contained. These sources provide background, not a
required reading list for every use:

* Martin Fowler's [YAGNI](https://martinfowler.com/bliki/Yagni.html): speculative capabilities have a continuing cost; keeping code easy to change remains valuable.
* Sandi Metz's [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction): restoring separate implementations can reveal a better model than extending a shared abstraction with more conditions.
* Google's [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html): assess design and understandability, and question generality beyond current needs.
