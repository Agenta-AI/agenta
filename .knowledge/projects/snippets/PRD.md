# PRD: Composable Config Embedding + Snippets Profile

Status: draft  
Owner: TBD  
Last updated: 2026-02-11

## Product Intent

Enable composable configurations where teams can define reusable building blocks once (instructions, guardrails, model presets, schemas, tool settings, message snippets, subagent configs), commit and test them independently, and compose them by reference into higher-level configurations.

Composition must support both pinned-version references and floating/latest references, with clear UX to inspect and safely change what is being referenced.

## Context and Opportunity

Teams want to:

- centralize shared configuration content instead of copy/pasting across apps,
- evolve nested pieces independently with their own lifecycle,
- compose larger behaviors from smaller tested components,
- choose whether a reference tracks latest or a specific version.

This is not only for snippet-like text content; it applies to any reusable configuration object.

## Problem Statement

Without a productized embedding system, users cannot reliably compose configurations across string and JSON contexts with predictable dereferencing, insertion, and resolution semantics.

Without strong reference UX, users also cannot safely understand or change composition over time:

- they need to see the reference itself and what it resolves to,
- they need to compare current target vs candidate target before applying a change,
- they need multiple views for editing/debugging (raw/pretty, resolved/unresolved).

## Scope Split (Design Framing)

## Track A: Embedding System

A product-level contract for reference declaration, selector semantics, dereference, insertion, and resolution for any embeddable configuration object.

## Track B: Snippets Profile

A specific profile on top of Track A: non-runnable, message-oriented reusable content with a default selector behavior optimized for common snippet use.

## Goals

1. Support nested composition in both string and JSON/object contexts.
2. Provide unique and parseable references with selector semantics.
3. Support both pinned and floating (latest) reference targeting.
4. Standardize dereference/resolve behavior with deterministic outcomes.
5. Provide UX that makes reference edits safe and explainable.
6. Define snippets as one embeddable profile without limiting the system to snippets.

## Out of Scope (This PRD Phase)

- Branch-specific API/path/entity naming decisions.
- Full migration and deprecation sequencing across legacy contracts.
- Final visual design details for every screen state.

Implementation mechanics remain in RFC(s).

## Target Users

- Builders composing runtime configs from reusable components.
- Teams curating centralized shared resources (instructions, guardrails, snippets, schemas, model presets).
- Platform teams maintaining config composition across API/SDK/UI.

## Core Use Cases

1. Embed selected content into a string field.
2. Embed selected content into a JSON key/node.
3. Compose recursively (A references B, B references C).
4. Use snippet content as a default message source in larger runnable configs.
5. Reuse non-snippet artifact types through the same mechanism (subagents, guardrails, models, schemas, tools).
6. Switch a reference target (version/variant) with a pre-apply diff preview.
7. Inspect both unresolved and resolved states of the same config.

## Product Requirements

## A) Generic Embedding System Requirements

1. Support both embedding forms:
- string-embedded reference markers,
- JSON/object embedding markers.

2. Define a canonical reference shape that is unambiguous and parseable.

3. Define selector behavior for extracting a sub-part of referenced content.

4. Define selector precedence rules consistently across embedding forms.

5. Support recursive resolution with explicit guardrails (depth, cycle, count limits).

6. Preserve type intent:
- object embeddings inject structured values,
- string embeddings inject string output with explicit conversion rules.

7. Define policy behavior for missing refs, invalid selectors, cycles, and depth overflow (e.g., placeholder vs strict errors).

8. Support target strategy per reference:
- pinned target (specific version/revision),
- floating target (latest/default moving target).

## B) Reference UX Requirements

1. Users can inspect reference metadata and resolved value side by side.

2. Users can preview the resolved output before saving/applying changes.

3. When changing reference target (e.g., version/variant), users can see a before/after diff before apply.

4. Users can view configuration in at least four modes:
- raw + unresolved,
- raw + resolved,
- pretty + unresolved,
- pretty + resolved.

5. UI clearly indicates when content is resolved from references vs literal local content.

## C) Snippets Profile Requirements

1. A snippet is a non-runnable, reusable message-oriented configuration profile.

2. Snippets can be embedded anywhere Track A supports embedding.

3. Snippets provide a default selector optimized for snippet usage (initially first-message-focused behavior), while allowing explicit override.

4. Snippets are one profile among many embeddable profile types; system capabilities must remain profile-agnostic.

## Non-Functional Requirements

- Deterministic resolution for same inputs and same target versions.
- Bounded and safe resolver execution.
- Backward-compatible extension path for additional embeddable profiles.
- Strong observability for resolution behavior and failures.

## Success Metrics

1. Composition adoption:
- percentage of saved configs using at least one reference.

2. Multi-context coverage:
- percentage of surfaces supporting both string and JSON embedding.

3. Reliability:
- resolution failure rate by class (missing, cycle, depth, selector).

4. Edit safety:
- percentage of target-change operations that used preview/diff before apply.

5. Profile extensibility:
- adoption of at least one non-snippet reusable profile type.

## Rollout Plan (Product-Level)

1. Publish generic embedding and reference UX contract.
2. Publish snippets profile contract on top of generic system.
3. Expand profile coverage (guardrails, models, schemas, tools, subagents).

## Risks

- Overfitting product semantics to one implementation.
- Ambiguity between snippet defaults and generic embedding behavior.
- UX complexity when exposing raw/resolved and multi-mode views.

## Dependencies

- Resolver/parser with deterministic reference extraction and insertion.
- Versioned storage model for embeddable artifacts.
- UI components for dual-view rendering and diff preview.
- API/SDK surfaces exposing consistent resolve and inspect behavior.

## Open Questions

- What is the final canonical reference model for pinned vs floating targets?
- What is the canonical diff unit for target changes (raw value diff, resolved diff, or both)?
- Which view mode should be default in editor UX?
