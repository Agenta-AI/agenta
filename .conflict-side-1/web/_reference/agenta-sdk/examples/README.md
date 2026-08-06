# Examples

Runnable scripts demonstrating common @agenta/sdk usage patterns.

## Setup

```sh
export AGENTA_API_KEY=sk-...
export AGENTA_PROJECT_ID=proj-...
export AGENTA_HOST=https://cloud.agenta.ai  # optional; defaults to localhost
```

## Run

```sh
pnpm tsx examples/fetch-prompt.ts
pnpm tsx examples/manage-variants.ts
pnpm tsx examples/run-evaluation.ts
```

Each example is self-contained and independent — they don't share state.

## What each one demonstrates

| File | Flow |
|---|---|
| `fetch-prompt.ts` | Init → fetch a prompt from the registry → handle the typed errors a real consumer hits |
| `manage-variants.ts` | Init → create application → commit a revision → deploy to environment → soft-delete (archive) |
| `run-evaluation.ts` | Init → create testset → find/use an evaluator → start a run → poll for results |
