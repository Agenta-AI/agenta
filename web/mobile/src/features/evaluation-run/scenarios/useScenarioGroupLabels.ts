import {useMemo} from "react"

import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {testsetQueryAtomFamily} from "@agenta/entities/testset"
import {workflowArtifactQueryAtomFamily} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

import {groupFallbackLabel} from "./scenarioColumns"

/** The id of the entity a group stands for: its test set, app or evaluator. */
function groupEntityId({group}: RunColumnGroup): string | null {
    const references = group.refs
    if (group.kind === "testset") return references?.testset?.id ?? null
    if (group.kind === "application") return references?.application?.id ?? null
    if (group.kind === "evaluator") return references?.evaluator?.id ?? null
    return null
}

/**
 * The header of each column group, by group key: the name of the test set, the app or the
 * evaluator, else a label made from its slug. The atom is rebuilt only when a group changes.
 */
export function useScenarioGroupLabels(groups: RunColumnGroup[]): Record<string, string> {
    const spec = JSON.stringify(
        groups.map((entry) => [
            entry.group.key,
            entry.group.kind,
            groupEntityId(entry),
            groupFallbackLabel(entry.group),
        ]),
    )
    const labelsAtom = useMemo(() => {
        const entries = JSON.parse(spec) as [string, string, string | null, string][]
        return atom<Record<string, string>>((get) =>
            Object.fromEntries(
                entries.map(([key, kind, id, fallback]) => {
                    const name = id
                        ? kind === "testset"
                            ? get(testsetQueryAtomFamily(id)).data?.name
                            : get(workflowArtifactQueryAtomFamily(id)).data?.name
                        : null
                    return [key, name?.trim() || fallback]
                }),
            ),
        )
    }, [spec])
    return useAtomValue(labelsAtom)
}
