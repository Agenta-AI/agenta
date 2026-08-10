# Notes

Replaced designs and observations for `v2/`. Read this when a shape here looks wrong and you
want to know whether it was already tried.

The research-phase record — four reversed positions and the observations behind them — is in
[`../v1/notes.md`](../v1/notes.md) and is not repeated. It remains the authority for why the
principal is not a blocker, why dual-mode adoption was rejected, why "in-process" was the
wrong frame, and why the internal tool-delivery channel is excluded.

---

## Structural notes

### There is no sibling domain to mirror

Channels chose an existing multi-provider integration domain as its structural sibling and
copied its layout. The gateways have no such sibling **because they extend the family that
would have been it** — catalog, connections, tools and triggers.

The consequence shaped `entities.md`: most structural questions are already answered by what
exists, and the design work is additive rather than parallel. The exception is the model
plane, which has no domain at all today and is therefore the one place where a genuinely new
structure has to be chosen.

### Why `mcp.md` and `models.md` replaced the channels quarantine document

Channels pushed platform facts into one document so the neutral documents would survive
platform churn. The same reasoning applies here twice over, because the two planes churn
independently: the protocol revises on its own schedule, and provider APIs on theirs. One
combined document would couple them.

### Why there is no capability-declaration document

Channels needed one because its adapters had genuinely different feature sets and core had to
decide what was offerable. Here the adapter differences are narrow and already expressible —
auth mode on the tool side, provider and deployment on the model side — so a declaration
layer would be ceremony. `policy.md` occupies that slot instead, since what actually varies
is policy rather than capability.

Revisit if MCP server differences turn out to be wider than auth mode.

### Why there is no out-of-process adapter contract

Channels needed a wire contract because third parties would implement bridges. No equivalent
need has been established here. Inventing one would create a compatibility surface with no
consumer.

---

## Watch list

- Whether `policy.md` splits into two documents with little in common. If it does,
  `decisions.md` D1 is wrong and the gateways should be separate systems.
- Whether the routing library is usable in-process. This decides whether the model plane is a
  library integration or a service, and several packages depend on the answer.
- Whether refresh-token support is complete in the MCP SDK version we would pin.
- Whether any upstream we care about lacks Client ID Metadata Document support and forces the
  deprecated registration fallback.
- Whether the deprecation of server-side sampling changes what upstream servers do, since a
  server needing a model would then call the LLM gateway — the point where the planes touch.
