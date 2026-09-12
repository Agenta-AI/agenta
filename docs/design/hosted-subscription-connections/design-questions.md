# Open design questions

These questions are the AI agent's design analysis, not additional user requirements or settled
implementation choices. Evaluate options against the [user requirements](requirements.md).
The [v0 proposal](v0/README.md) is a starting point that may miss important details.

## 1. Which harness provides the simplest complete path?

Can Codex or Pi support UI-driven ChatGPT login, hosted execution, and concurrent credential renewal
with the deployed versions? What supported interfaces do they expose for login, credential
injection, refresh, and reload? Does the login component need to be the execution harness?

Prove one end-to-end path, including an actual refresh, before choosing. A convenient login API
alone does not establish that the execution and renewal path meets the concurrency requirement.
Supporting both harnesses is optional.

## 2. What happens when credentials change during parallel runs?

When session A renews credentials, can session B keep using its access token? Before B's next
request or refresh, where does it get the latest state? What if both refresh simultaneously, run on
different machines, or keep credentials cached in long-lived processes?

What happens if the provider accepts a refresh but the worker crashes or loses the response before
saving the result? Which failures permit recovery and which require another login? Can the chosen
harness coordinate this itself, or does Agenta need to participate?

Compare independent runs through the same harness first. Cross-harness synchronization is not a
first-release requirement. Test simultaneous expiry, stale reads, multiple workers, and interruption
around refresh. Do not assume that copying a file or locking writes alone solves renewal.

## 3. Where can login and execution run with an adequate isolation boundary?

Which component should receive a UI login request, which process should exchange credentials with
the provider, and which process should execute model requests? Could existing services provide the
needed boundary, or would a separate worker be required?

How can the trusted authentication consumer access credentials while another tenant and
model-directed tools cannot? Would native file storage expose credentials to shell tools? Would an
injection or broker approach be supported by the selected harness? Prove the boundary on the actual
cloud runtime before selecting the deployment layout.

## 4. What does project or organization scope permit?

Which existing connection and permission model makes scope simplest? Who can see, use, reconnect,
and remove a subscription? Does joining a project or organization grant use of the connecting
person's account? What happens when that person leaves, or their membership changes?

Storage scope alone does not settle who can spend the subscription. Resolve the permissions before
finalizing the connection record. The user has not selected project over organization scope or
specified these management rules.

## 5. What must persist, and how does it reach the next worker?

What state must survive a worker restart to keep the login usable? Which formats and storage
interfaces does the chosen harness support? Can existing credential infrastructure handle mutable
subscription authentication, or is separate storage necessary?

How do a new worker and an already-running session observe current credentials? Evaluate storage,
routing, and refresh together. Do not assume a persistent volume, shared filesystem, database,
dedicated runner, or central credential service before establishing the actual requirements of the
chosen harness.

## 6. What user-visible behavior is needed beyond initial sign-in?

How does the existing model picker identify a subscription and its supported models? Which parts
can be reused? What should users see while login is pending, when authorization expires, or when
the provider imposes a usage limit? What should happen to active sessions during reconnect or
removal?

Are schedules, events, and other invocation paths included in this release? What practical
concurrency level should validation cover? These answers must be explicit; neither interactive-only
use nor a numerical session limit was specified by the user.

## 7. What should remain extensible for Grok?

Which decisions are specific to ChatGPT and the chosen harness? Could a second provider use a
different login, credential format, refresh mechanism, or execution client without replacing the
user-facing subscription concept?

Document those boundaries now. Defer Grok implementation and avoid requiring a generic provider
framework until a concrete need is established.

## Investigation alongside implementation

Use [working research](working-research.md) to pursue these questions alongside the UI, backend,
and session implementation. Concurrent research should improve a working application rather than
block all implementation until an architecture is selected. Native shared storage and session-owned
refresh are the initial hypotheses. A single authentication-owning process is the last option.
