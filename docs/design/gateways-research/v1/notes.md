# Notes

Replaced positions and observations. Read this when something in the other documents looks
wrong and you want to know whether it was already considered.

Everything else in `v1/` states only what is. History lives here.

---

## Replaced positions

### The principal was not a blocker

An early draft treated identity as the blocking decision, on the reading that connections
are project-scoped and therefore the platform could not attribute a call to a person.

That conflated two separate things. **Who is calling us** is answered on every request by an
auth context carrying organization, workspace, project and user, rejected outright if any is
missing. **Which stored credential we then use** is a different lookup. The first was never
in question.

The correction matters beyond the one point: it is why `secrets-scoping.md` treats
attribution and credential ownership as independent, and why user-level credentials do not
require any caller-side change.

### Dual-mode adoption was wrong

An early version offered "gateway and direct paths coexist, defaulting to direct." Rejected:
a governance boundary with an exception is not a boundary, and one bypass costs every claim
about policy, audit, spend, and credential containment. See `decisions.md` S1.

The related understatement — that adoption is "a resolver-side change" — was only ever true
of the runner caller, whose wire already expresses a gateway route. Every other caller is a
real change.

### "In-process in the SDK" was the wrong frame

An early argument preferred converting the workflow path first because it runs in-process.
That framing is wrong regardless of which path goes first: callers depend on ports, and the
adapter behind the port talks to the gateway. The SDK keeps its secret-fetch and
secret-injection capabilities; only the implementation behind them changes.

### The internal tool channel is not a proto-gateway

The runner has an internal channel that delivers first-party tools to a harness over MCP. It
was briefly cited as evidence that an MCP gateway already half-exists.

It is a separate concern — internal tool delivery, not third-party server brokering — and
conflating the two would drag its permission-rule and transport constraints into a design
that does not need them. Excluded deliberately.

---

## Observations

### The auth-scheme axis was already built

Proposed here as new, then found implemented across three domains, along with the
ready / needs-auth / needs-input state machine and a connect affordance returned from
discovery. Both auth schemes already share one hosted-redirect flow with no secret on the
request payload.

The lesson generalizes: this design's remaining novelty is much smaller than it first
appeared, and the reflex should be to look for the existing shape before proposing one.

### The two-axis credential model came from a real gap

"API key versus OAuth" conflates authentication method with credential ownership. Personal
access tokens are static and per-user; some OAuth grants are organizational. The existing
code has the first axis and not the second — correctly, since ownership does not yet vary.

### Statelessness and OAuth get conflated easily

Going stateless removed protocol session state. OAuth is credential lifecycle state. The
current MCP revision removes the first and leaves the second fully specified. The gain from
statelessness is a cheaper gateway, not less authorization work.

### The spec now favours intermediaries

Three changes in the current revision are explicitly about things sitting in the middle:
header-based routing, cacheable list results with a shared-intermediary scope flag, and the
replacement of server-initiated callbacks with a retry pattern. That last one is what turns
a gateway from a stateful broker into a plain proxy.

Worth watching: the deprecation of server-side sampling suggests servers needing a model
should call a model API directly. In a two-gateway world that means an MCP server calling
the LLM gateway, which is where the two planes touch.

### Folder names mislead on the model side

The SDK folder named after the model client library holds an observability callback handler.
The actual routing lives in the secrets manager's provider-settings builder. Anyone sizing
the model work from folder names will size the wrong thing.

---

## Watch list

- Whether refresh-token support in the MCP SDK is complete in the version we would pin.
  It was still landing across SDKs during 2026.
- Whether the deprecation window for sampling, roots and logging changes what upstream
  servers actually do, since it runs at least twelve months.
- Whether any upstream we care about lacks Client ID Metadata Document support and forces
  the deprecated dynamic-registration fallback.
