# Hosted subscription connections

Build a working exploratory implementation while investigating authentication and concurrent
refresh. There is no timebox; a recommendation alone is not the intended result. Architecture
choices remain open, and experiments can change the implementation.

## Reading order

1. [Requirements](requirements.md): Mahmoud's product requirements, edited only for clarity.
2. [Working research](working-research.md): current direction, architecture experiments, parallel
   implementation tracks, and validation.
3. [Fable prompt](fable-prompt.md): editable handoff for Mahmoud to send.
4. [Communication log](communication-log.md): asynchronous updates, feedback, and handoffs.
5. [Status](status.md): current workspace, ownership, and next work.
6. [Technical inferences](technical-inferences.md) and [design questions](design-questions.md):
   explicitly labeled AI analysis. Consult working research for the current exploration direction.
7. [v0](v0/README.md): original plan, context, research, status, and walkthrough. It is a good
   starting point, but it may miss important requirements and design questions.

## Terms

A harness is the coding client, such as Codex or Pi. A runner starts and manages the harness. A
session holds one conversation. Authentication state contains credentials used and renewed by the
client. A mount exposes storage as a directory; its behavior depends on the storage and filesystem
adapter. A coordination component can share credential changes without owning provider refresh.

The v0 assumptions about one active run, private owner-only use, and Grok in the first release do
not define the current scope. Existing research needs verification against the versions and cloud
runtime used for these experiments.
