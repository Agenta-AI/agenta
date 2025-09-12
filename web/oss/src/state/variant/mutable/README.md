# Mutable Variant/Prompt Atoms (Shared)

This folder documents the mutable atom architecture used across the app (not just Playground). It focuses on prompt-related state as the canonical example, but the patterns apply to any revision-scoped, variant-related mutable state.

## Overview

- **Single source of truth (prompts)**: `promptsAtomFamily(revisionId)` holds the full prompt tree for a given revision (variant revision ID).
- **Optimized reads**: Selector atoms read focused slices (e.g., a single property or metadata) to minimize re-renders.
- **Centralized writes**: Mutation atoms encapsulate write logic, side-effects, and revision resolution.
- **Facade atoms**: A simple read/write facade is available for prompts-only use cases, abstracting the underlying mutation.

These atoms originated in the Playground, but are now shared across features that need consistent prompt state access.

## Data Flow (from fetch to UI)

1. **Variant/Revisions fetched** via server queries (outside this folder).
2. **Prompts cached per revision** in `promptsAtomFamily(revisionId)`.
3. **Components read** focused values via selector atoms:
    - `unifiedPropertyValueAtomFamily({ revisionId?, propertyId, rowId? })`
    - `unifiedPropertyMetadataAtomFamily({ revisionId?, propertyId, rowId? })`
4. **Components write** through mutation atoms (never write directly to objects):
    - `updateVariantPropertyEnhancedMutationAtom({ variantId: revisionId, propertyId, value })`
5. **Optional facade** combines 3 and 4 into a single read/write API for prompts-only:
    - `promptPropertyAtomFamily({ revisionId, propertyId })`

## Key Atoms

- **promptsAtomFamily(revisionId)**
    - Source of truth for all prompt data per revision.
    - Lives in: `@/oss/state/newPlayground/core/prompts`.

- **updateVariantPropertyEnhancedMutationAtom**
    - Centralized write path for prompt property updates.
    - Resolves the correct target revision ID, updates nested property shapes, and maintains prompt key consistency.
    - Lives in: `web/oss/src/components/Playground/state/atoms/propertyMutations.ts`.

- **unifiedPropertyValueAtomFamily / unifiedPropertyMetadataAtomFamily**
    - Read-only selectors. Provide value/metadata for a given property from either prompts or generation data based on params.
    - Useful for components that should not subscribe to the full prompt tree.
    - Lives in: `web/oss/src/components/Playground/state/atoms/propertySelectors.ts`.

- **promptPropertyAtomFamily** (prompts-only facade)
    - Read/write atom family for prompts-only scenarios.
    - Read: selects `(property.content?.value ?? property.value)` from `promptsAtomFamily(revisionId)`.
    - Write: delegates to `updateVariantPropertyEnhancedMutationAtom`.
    - Lives in: `web/oss/src/components/Playground/state/atoms/propertySelectors.ts`.

## Why selectors AND mutation atoms?

- **Single source of truth** reduces duplication and drift.
- **Selectors** keep subscriptions narrow (component re-renders only when the specific slice changes).
- **Mutations** centralize write logic, handle nested property shapes, and prevent inconsistent updates spread across components.
- This split provides performance and maintainability while preserving a coherent data model.

## Facade: prompts-only read/write

For straightforward prompt edits where you have a `revisionId` and `propertyId`, use the facade:

```ts
import {useAtom, useAtomValue} from "jotai"
import {promptPropertyAtomFamily} from "@/oss/src/components/Playground/state/atoms"

const value = useAtomValue(promptPropertyAtomFamily({revisionId, propertyId}))
const [, setValue] = useAtom(promptPropertyAtomFamily({revisionId, propertyId}))
setValue(next)
```

- Internally writes through `updateVariantPropertyEnhancedMutationAtom`.
- Keeps all prompt updates consistent and testable.

## Scope and Non-goals

- **In scope**: Prompt-related atoms and mutation patterns, revision-local prompt updates.
- **Out of scope**: Generation data atoms and mutations (they use `playgroundStateAtom.generationData` as their source of truth and have separate mutations).

## Notes

- "revisionId" here always refers to the variant revision identifier (not the parent variant ID).
- If a consumer only needs to read, prefer selector atoms (`unifiedPropertyValueAtomFamily`,
- If a consumer needs to write, prefer the facade (`promptPropertyAtomFamily`) or call the mutation atom directly for advanced cases.
