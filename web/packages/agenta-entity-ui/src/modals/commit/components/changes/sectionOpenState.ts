/**
 * Which change sections start expanded.
 *
 * Its own module so it can be unit-tested without importing the summary component, which pulls the
 * Monaco-backed DiffView and cannot load in a node-environment test.
 */

/**
 * Open state for one section. An explicit toggle wins; otherwise the `defaultOpen` policy decides.
 *
 * Deliberately NOT lazy component state seeded from `sections`: the approval card classifies its
 * delta once the committed configuration arrives, so sections can land after the first render, and
 * a seeded set would leave those late sections shut.
 */
export const isSectionOpen = (
    overrides: Record<string, boolean>,
    id: string,
    defaultOpen = false,
): boolean => overrides[id] ?? defaultOpen
