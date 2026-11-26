# Design warning signs (optional)

A one-page list for when a finding needs a short name for a structural problem. A sign tells you
where to look. It is not a finding by itself.

| Sign | What you see |
| --- | --- |
| Thin module | Callers must learn about as much as the code contains. |
| Scattered decision | Several modules each hold their own copy of one design choice. |
| Split by run order | Modules follow the order of the steps, so each needs to know about the others. |
| Rare options up front | A simple call still has to deal with settings few callers use. |
| Forwarding method | The method hands its arguments to another method and adds nothing. |
| Unused passenger | A value goes down through layers that only hand it along. |
| Copied logic | One decision appears as code in more than one place. |
| Feature code in a general part | A shared mechanism has branches for one specific feature. |
| Methods that need each other | You must read both methods to follow either of them. |
| Comment that echoes | The comment adds nothing beyond the line below it. |
| Internals in the docs | The interface docs explain things callers never need. |
| Empty name | The name gives no clue about the thing. |
| Name nobody can settle on | The thing may be two concepts merged into one. |
| Long list of exceptions | The contract takes many special cases to explain. |
| Puzzling code | A reader cannot work out what the code does, or why. |
