import {useCallback, useMemo} from "react"

import type {PlaygroundNode} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

/**
 * The name each playground node shows on its result: an evaluator's own name, else the revision
 * name, else the node label when it is not an id, else the entity type ("Workflow").
 */
export const usePlaygroundNodeLabels = (nodes: PlaygroundNode[] | null) => {
    const nodeNamesAtom = useMemo(
        () =>
            atom((get) => {
                if (!nodes) return {} as Record<string, string>
                const names: Record<string, string> = {}
                for (const node of nodes) {
                    const data = get(workflowMolecule.selectors.data(node.entityId))
                    // Evaluators don't use variants: label them by the entity
                    // (artifact) name. The revision's own `name` carries the
                    // variant name ("default"). App nodes keep the revision
                    // name, which is the variant label in comparison views.
                    if (data?.flags?.is_evaluator) {
                        const artifactName = get(
                            workflowMolecule.selectors.artifactName(node.entityId),
                        )
                        if (artifactName) {
                            names[node.id] = artifactName
                            continue
                        }
                    }
                    if (data?.name) {
                        names[node.id] = data.name
                    }
                }
                return names
            }),
        [nodes],
    )
    const nodeNames = useAtomValue(nodeNamesAtom)

    const getNodeLabel = useCallback(
        (node: PlaygroundNode) => {
            const resolvedName = nodeNames[node.id]
            return (
                resolvedName ||
                (node.label && !/^[0-9a-f]{8}-/.test(node.label)
                    ? node.label
                    : node.entityType.charAt(0).toUpperCase() + node.entityType.slice(1))
            )
        },
        [nodeNames],
    )

    return {nodeNames, getNodeLabel}
}
