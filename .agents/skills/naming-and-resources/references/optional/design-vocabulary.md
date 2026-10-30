# Design vocabulary (optional)

Load this page when a design discussion or a review mixes words such as module, layer,
boundary, component and service. Use these words with these meanings, so reviews and specs
say the same thing.

**Module**: anything with an interface and an implementation: a function, a class, a
package, or a slice across layers.
_Avoid_: unit, component (as a general word)

**Interface**: everything a caller must know to use a module: the signature, plus
invariants, call order, error modes, required configuration and cost.
_Avoid_: signature (too narrow)

**Implementation**: the code inside a module.

**Depth**: how much behavior a caller gets for each thing it must learn. A deep module hides
much behind a small interface. A shallow module's interface is nearly as complex as its
implementation.

**Seam**: the place where a module's interface lives, where behavior can change without
editing the callers.
_Avoid_: boundary (in Agenta, also used for API and trust boundaries)

**Adapter**: a concrete thing that fills an interface at a seam, for example a provider
adapter under `core/<domain>/providers/<name>/`.

**Layer**: one of the Agenta responsibilities: router, service, DAO interface, DAO
implementation (`api/AGENTS.md`). A layer is a responsibility, not a deployment.
_Avoid_: tier, service (as a synonym for layer)

**Locality**: what maintainers get from depth: a change, a bug or a rule sits in one place.
