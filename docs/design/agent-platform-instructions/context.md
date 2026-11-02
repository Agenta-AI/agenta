# Context

The SDK already sends gateway guidance separately from author instructions. It
builds that guidance in `adapters/agenta_builtins.py`, which also contains bundled
skills, and sends a `gatewayGuidance` object containing text and a delivery choice.
The runner combines the text with the appropriate instruction field when it builds
an environment.

Every supported agent should also receive a short Agenta base instruction. Adding
that base should make prompt ownership easier to understand without adding another
delivery or session-management system.

## Scope

The SDK owns the common base and guidance derived from configured integrations.
The runner owns environment facts, such as mount availability and paths, and decides
how to deliver text. The author owns project instructions and Pi system options.

Move the SDK text to one module and send it as `platformInstructions`. Keep existing
delivery channels and the existing timing of instruction refreshes. Remove the
SDK's gateway-specific carrier type and helper.

## Outside this change

There is no instruction digest, database migration, native-session eligibility
check, new restart rule, prompt registry, or public configuration option. This does
not change Pi process arguments, Codex developer instructions, mount paths, or skill
installation. Session continuity and mount fallback problems require their own
reproduction and fix.
