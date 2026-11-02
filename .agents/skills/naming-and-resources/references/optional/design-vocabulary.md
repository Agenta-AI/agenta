# Design vocabulary (optional)

Load this page when a design discussion or a review uses module, layer, boundary, component and
service loosely. Use these meanings, so that reviews and specs agree.

**Module**: any piece of code that callers use from the outside, at any size. It can be one
function, a class, a package, or a feature that runs through several layers.
_Avoid_: unit, component (as a general word)

**Interface**: the full set of facts a caller depends on. That covers the parameters and also
the rules on call order, the errors, the configuration it needs and how slow it can be.
_Avoid_: signature (it covers only part of this)

**Implementation**: the code behind the interface.

**Depth**: the ratio of what a module does for callers to what they must learn to use it. High
depth means a little to learn and a lot done. Low depth means callers learn about as much as the
code itself contains.

**Seam**: the point where you can swap the behavior behind an interface and leave its callers
untouched.
_Avoid_: boundary (in Agenta, also used for API and trust boundaries)

**Adapter**: the code at a seam that connects one specific thing to the interface, for example
a provider under `core/<domain>/providers/<name>/`.

**Layer**: one of the Agenta code roles: router, service, DAO interface, DAO implementation
(`api/AGENTS.md`). Layers divide work inside the code. They say nothing about where the code
is deployed.
_Avoid_: tier, service (as a synonym for layer)

**Locality**: the benefit of depth for maintainers. One fix or one rule change happens in one
file or one small group of files.
