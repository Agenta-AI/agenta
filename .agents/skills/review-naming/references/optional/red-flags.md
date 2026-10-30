# Design red flags (optional)

A one-page list for naming a structural smell in a finding. A red flag is a prompt to look,
not a finding by itself.

| Red flag | Meaning |
| --- | --- |
| Shallow module | The interface is nearly as complex as the implementation. |
| Information leakage | One design decision is known in several modules. |
| Temporal decomposition | Modules split by the order things happen, so they share knowledge. |
| Overexposure | Common callers must know about rare options. |
| Pass-through method | A method only forwards to another with a similar signature. |
| Pass-through variable | A value threaded through layers that do not use it. |
| Repetition | The same decision coded in several places. |
| Special-general mixture | A general mechanism holds code for one feature. |
| Conjoined methods | Two methods can only be understood together. |
| Comment repeats code | The comment says what the code says. |
| Implementation in interface docs | Interface docs describe internals callers do not need. |
| Vague name | The name does not say what the thing is. |
| Hard to pick name | No precise name fits; the concept may mix two things. |
| Hard to describe | The contract needs many exceptions to state. |
| Non-obvious code | A reader cannot tell what it does or why. |
