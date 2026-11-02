# Signature checks (optional)

Load this page when the spec defines a function, method or route signature with several
parameters of one type, boolean parameters, defaults, or steps that must run in a set order.

For each check, try the mistake in the second column on the proposed signature.

| Check | Try this mistake | What can help |
| --- | --- | --- |
| Boolean arguments | Read a call with no declaration in view. Is the meaning of `False` clear? | Keyword-only parameters (the Agenta `*` style), or a separate named operation for each case. |
| Parameters of one type | Exchange two ids in a call. Does anything complain? | Keyword-only parameters, distinct id types, or a single object that holds the values. |
| Defaults | Omit an option. Do the docs, the schema and the running code pick the same value? | Write one default down in one place. Make the caller state anything with a serious side effect. |
| Required order | Call the second step first, or stop halfway through. | Check everything when the object is created, or offer one call that does all the steps. |
| No results | Query for a list that has no rows. Do you get `None` or `[]`? | Return `[]` for an empty list. Use `None` only where the contract defines it as "does not apply". |

Agenta style: service and DAO methods take keyword-only parameters after `*`, grouped with
`#` lines (`api/AGENTS.md`, Router and function style conventions). A spec signature that
does not follow it is a finding only when it is new surface.
