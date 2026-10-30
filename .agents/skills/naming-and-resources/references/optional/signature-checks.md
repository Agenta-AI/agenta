# Signature checks (optional)

Load this page when the spec defines a function, method or route signature with several
parameters of one type, boolean parameters, defaults, or setup that must happen in order.

Each check has a misuse test. Run the test in your head against the proposed signature.

| Check | Misuse test | Improvement to consider |
| --- | --- | --- |
| Positional booleans | Read the call without the declaration. Can you tell what `True` means? | Keyword-only parameters (the Agenta `*` style), or a named operation per case. |
| Same-type parameters | Swap two arguments of the same type. Does it still type check? | Keyword-only parameters, typed ids, or one parameter object. |
| Defaults | Leave out each option. Do the docs, the schema default and the runtime default agree? | One documented default. Keep consequential side effects explicit. |
| Setup and order | Call before setup, or set properties in another order, or fail halfway. | Validate at construction, or one scoped operation that cannot leave half-set state. |
| Null against empty | Ask for a list with no items. Does the call return `None` or `[]`? | Return an empty list for "no items"; keep `None` for "not applicable" only if the contract says so. |

Agenta style: service and DAO methods take keyword-only parameters after `*`, grouped with
`#` lines (`api/AGENTS.md`, Router and function style conventions). A spec signature that
does not follow it is a finding only when it is new surface.
