/**
 * Playground UI feature flags.
 *
 * Small Jotai atoms for opt-in / behind-the-scenes UI swaps that we want
 * to ship dark-launched. OSS (or any consumer) flips them on once a
 * change is ready to be user-visible.
 *
 * Today these are session-scoped plain atoms — no persistence, no env-var
 * wiring. Promote to `atomWithStorage` keyed by user/app if any of them
 * stick around long-term as user preferences.
 */

import {atom} from "jotai"

/**
 * When `true`, the playground's per-variable input cells (rendered today
 * by `VariableControlAdapter`) get replaced with the V2-aligned
 * `PlaygroundInputsBody` component (bordered card per variable, type
 * chip + "View as ▾" dropdown, native JSON edits).
 *
 * Default `false` — existing rendering is preserved. The consumer (OSS
 * playground entry, an `init()` effect, a dev toggle) flips this on once
 * the new UX is signed off. When the new path is the default for everyone,
 * delete this flag and the conditional in `SingleLayout`.
 *
 * Wired only for SingleLayout's flat (non-grouped) path in the initial
 * cut. Grouped evaluator layouts and ComparisonLayout still use the
 * adapter — see the deferred follow-ups in the approved design doc.
 */
export const useNewPlaygroundInputsBodyAtom = atom<boolean>(false)
