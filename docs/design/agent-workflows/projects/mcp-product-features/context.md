# Context

After the cleanup, users can save a truthful external HTTP MCP configuration for supported
harnesses. They still cannot prove a server connects before a run, see discovered tools, diagnose
initialization failures, or select tools from real server metadata. Static secret references
exist in the contract, but OAuth and the long-run credential boundary do not.

## Goals

- Test the same connection behavior execution uses.
- Show safe connection and initialization status.
- Discover tools and let users select real tool names.
- Enforce selection and permission at an execution boundary.
- Add credential-backed and OAuth connections without storing values in revisions.
- Choose the long-run execution boundary with evidence from Claude and Pi.

## Non-goals

- Reintroducing public stdio.
- Adding a compatibility decoder or feature flag.
- Changing the role-based saved object.
- Treating prompt instructions as policy enforcement.
- Choosing the MCP gateway before the Pi 2.2 plan establishes the actual bridge requirements.
