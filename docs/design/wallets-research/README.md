# Wallets

Design and research for a **credit ledger** — one balance per organization, computed from
entries we never edit, so credits can be granted, bought, earned, and spent across models,
tools and sandbox time.

The **gateway** that spends against that balance is designed elsewhere, in
[docs/design/gateways-research/](../gateways-research/). That design owns the request path
(D11) and names the ledger a *caller* of it. This one owns what a caller decides.

`v1/` is the current version. Start at [v1/README.md](v1/README.md).
