import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

/**
 * Holds a per-revision parameters override object when the JSON editor is used.
 * - null/undefined means no override and normal prompt-derived params apply.
 * - when set, commit flow can use this override directly.
 */
export const parametersOverrideAtomFamily = atomFamily((revisionId: string) =>
    atom<Record<string, any> | null>(null),
)
