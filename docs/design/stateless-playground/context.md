# Context: Stateless Playground

## Background

Currently, the Agenta playground is tightly coupled to apps (prompts). The URL structure is:
```
/w/{workspace_id}/p/{project_id}/apps/{app_id}/playground
```

Users must first create an app (prompt), which involves:
1. Creating the app entity
2. Deploying a variant (which provisions a service)
3. Then using the playground

This creates friction for users who want to quickly experiment with prompts without committing to a full app structure.

## Motivation

1. Quick experimentation. Users want to test prompts without creating apps.
2. Onboarding. New users can immediately start playing with the platform.
3. Import from traces (future). Users viewing a trace may want to try a prompt without creating an app.
4. Evaluation preparation. Users want to test a prompt before they formalize it into an app and evaluation.

## Problem Statement

The current playground requires an app context, which means:
- URI comes from the deployed variant
- Configuration is stored in variant revisions
- Schema is fetched from the runtime service OpenAPI spec (`openapi.json`)
- Test cases are typically linked to testsets (persistent)

We need a playground that:
- Works without an app
- Uses the shared completion service
- Keeps everything in memory (no persistence)
- Allows the same prompt editing, test case management, and execution experience

We also want a solution that is maintainable. The goal is to reuse the existing Playground UI and worker execution path by swapping the bindings (adapter), not by copying components.

## Goals

1. Project level playground. Users access it at `/w/{workspace_id}/p/{project_id}/playground`.
2. No app binding. The page does not require an app, variant, or revision entity.
3. Same completion service. The page executes against `services/completion` (and later `services/chat`).
4. Ephemeral state. Prompt configuration and test cases live only in memory.
5. Same UX. Reuse as much of the existing Playground UI as possible.
6. Import capability (future). Load a prompt from a trace span.

## Design Principles

We will introduce a small adapter layer that provides the values and actions the Playground UI needs.

- The existing app bound playground uses an app adapter.
- The new stateless playground uses a stateless adapter.

This keeps the UI stable, avoids duplicate implementations, and makes it easier to evolve both playground modes.

## Non-Goals

1. Persistence. The stateless playground does not save prompts to the backend.
2. Variant comparison. The first version is single prompt only.
3. Evaluation integration. The stateless playground does not run evaluations.
4. Deployment. The stateless playground does not deploy to environments.
5. Version history. There are no revisions or commits.

## Success Criteria

- User can access playground from project sidebar
- User can configure a prompt (system message, user template, model settings)
- User can add test cases with variable inputs
- User can run the prompt against test cases
- User can see results (output, latency, tokens, cost)
- Refreshing the page clears everything (expected ephemeral behavior)
- No 500 errors or backend failures
