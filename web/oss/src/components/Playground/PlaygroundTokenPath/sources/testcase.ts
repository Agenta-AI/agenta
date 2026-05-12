/**
 * Testcase source — `{{$.testcase.*}}` suggestions.
 *
 * Fully runtime-inferred. Nothing about the testcase schema is
 * hardcoded; we walk the actual testcase entities rendered in the
 * playground and collect next-segment keys at whatever depth the user
 * is typing.
 *
 * The envelope backs `WorkflowServiceRequestData.testcase`, which is a
 * `testcase.model_dump(mode="json")` on the backend — so observable
 * fields include whatever the user has populated (`data`, `meta`,
 * `tags`) plus server-assigned Lifecycle fields once persisted. All of
 * that surfaces naturally via the walk.
 */

import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {observedTestcasesAtom} from "../atoms"
import type {EnvelopeSource} from "../types"

import {aggregateObservedKeys} from "./shared"

const SLOT = "testcase"

export function useTestcaseSource(): EnvelopeSource {
    const observedTestcases = useAtomValue(observedTestcasesAtom)

    return useMemo<EnvelopeSource>(
        () => ({
            slot: SLOT,
            getSuggestions(afterSlot, query) {
                // Runtime walk at arbitrary depth. `aggregateObservedKeys`
                // descends each testcase along `afterSlot` (parsing JSON
                // strings on the way) and returns the union of next-level
                // keys, filtered by query.
                return aggregateObservedKeys(observedTestcases, afterSlot, query, "testcase")
            },
        }),
        [observedTestcases],
    )
}
