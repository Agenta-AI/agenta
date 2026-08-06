import {testcaseMolecule} from "@agenta/entities/testcase"
import {workflowMolecule} from "@agenta/entities/workflow"
import {executionItemController} from "@agenta/playground"
import {playgroundNodesAtom} from "@agenta/playground/state"
import {atom} from "jotai"

/**
 * Read every rendered testcase entity as-is. Sources that do runtime
 * inference (testcase, eventually trace/revision) walk these objects
 * to collect next-segment keys at arbitrary depth.
 *
 * Reactive — re-runs when the row list changes or any single testcase
 * is edited. Defined at module scope so the atom graph shares one
 * instance across re-mounts.
 */
export const observedTestcasesAtom = atom<unknown[]>((get) => {
    const rowIds = get(executionItemController.selectors.executionRowIds) as string[]
    const observed: unknown[] = []
    for (const rowId of rowIds) {
        const testcase = get(testcaseMolecule.data(rowId))
        if (testcase) observed.push(testcase)
    }
    return observed
})

/**
 * Unioned JSON Schema for the `parameters` envelope across every
 * workflow node currently on the playground (apps at depth 0, evaluator
 * nodes at deeper levels — an evaluator prompt can legitimately
 * reference `$.parameters.*` of its own workflow).
 *
 * Returns a synthetic object-typed schema whose `properties` map unions
 * top-level keys from each node's `schemas.parameters`. Sources can
 * walk it with `getSubPathsFromSchema` without caring that it came from
 * multiple workflows.
 */
export const aggregatedParametersSchemaAtom = atom<{
    type: "object"
    properties: Record<string, unknown>
} | null>((get) => {
    const nodes = get(playgroundNodesAtom)
    const properties: Record<string, unknown> = {}
    let sawAny = false
    for (const node of nodes) {
        const schemas = get(workflowMolecule.selectors.schemas(node.entityId)) as
            | {parameters?: {properties?: Record<string, unknown>}}
            | null
            | undefined
        const props = schemas?.parameters?.properties
        if (!props || typeof props !== "object") continue
        sawAny = true
        for (const [key, val] of Object.entries(props)) {
            if (!(key in properties)) properties[key] = val
        }
    }
    return sawAny ? {type: "object", properties} : null
})
