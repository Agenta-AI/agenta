/**
 * Per-variable view-mode state for `PlaygroundInputsBody`.
 *
 * One atom per (generation row, variable name). The atom holds either an
 * explicitly chosen `ViewType` (text/markdown/chat/form/json/yaml) or `null`
 * to mean "use the default for this value's kind" (computed at render via
 * `getDefaultViewForValue`).
 *
 * Session-scoped on purpose: a fresh atom family per app session. If users
 * later ask for persistence across reloads, swap the inner `atom(null)` for
 * `atomWithStorage` keyed by `(appId, varName)` — that's the explicit
 * follow-up tracked in the design doc.
 *
 * The family key uses `generationRowId` rather than `testcaseId` because
 * draft variables (referenced by the prompt but absent from the testcase)
 * don't yet have a stable testcase column ID. Generation rows are stable for
 * both authored and draft variables.
 */

import type {ViewType} from "@agenta/entity-ui/view-types"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"

export interface VariableViewModeKey {
    /** Stable identifier for the playground generation row this variable lives in. */
    rowId: string
    /** Variable name (the testcase column or referenced template variable). */
    varName: string
}

export const variableViewModeAtomFamily = atomFamily(
    (_key: VariableViewModeKey) => atom<ViewType | null>(null),
    (a, b) => a.rowId === b.rowId && a.varName === b.varName,
)
