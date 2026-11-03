import type {BuildHumanRunConfigInput} from "@agenta/entities/evaluationRun"
import {evaluatorOutputKeys} from "@agenta/entities/evaluationRun"
import {
    extractAllEndpointSchemas,
    extractInputKeysFromSchema,
} from "@agenta/entities/shared/openapi"
import {fetchTestcasesPage} from "@agenta/entities/testcase"
import {
    appOpenApiSchemaAtomFamily,
    appRoutePathAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {getDefaultStore, type Atom} from "jotai"

import type {DraftEvaluator, DraftRevision, DraftTestset} from "./newEvaluationDraft"

type Store = ReturnType<typeof getDefaultStore>

const SETTLE_TIMEOUT_MS = 15_000

/** Resolve with the atom's value once `ready` accepts it. Subscribing is what starts its query. */
export const settleAtom = <T>(
    store: Store,
    atom: Atom<T>,
    ready: (value: T) => boolean,
    timeoutMs = SETTLE_TIMEOUT_MS,
): Promise<T> =>
    new Promise((resolve, reject) => {
        let unsubscribe: () => void = () => undefined
        const timer = setTimeout(() => {
            unsubscribe()
            reject(new Error("The evaluation inputs did not load in time."))
        }, timeoutMs)
        const check = () => {
            const value = store.get(atom)
            if (!ready(value)) return
            clearTimeout(timer)
            unsubscribe()
            resolve(value)
        }
        unsubscribe = store.sub(atom, check)
        check()
    })

const propertyNames = (schema: unknown): string[] => {
    const properties = (schema as {properties?: unknown} | null | undefined)?.properties
    return properties && typeof properties === "object" ? Object.keys(properties) : []
}

/**
 * Read what `buildHumanRunConfig` needs from the stores, waiting for what has not loaded yet.
 * Each evaluator slug is the slug of the evaluator workflow, never of its revision.
 */
export async function readHumanRunInputs({
    store = getDefaultStore(),
    projectId,
    name,
    isCustomApp,
    revision,
    testset,
    evaluators,
}: {
    store?: Store
    projectId: string
    name: string
    isCustomApp: boolean
    revision: DraftRevision
    testset: DraftTestset
    evaluators: readonly DraftEvaluator[]
}): Promise<BuildHumanRunConfigInput> {
    const revisionEntity = await settleAtom(
        store,
        workflowMolecule.selectors.data(revision.id),
        (entity) => Boolean(entity),
    )

    let inputKeys: string[]
    let hasMessagesInput = false
    if (isCustomApp) {
        // A custom app declares its inputs in the OpenAPI document, which loads on demand.
        const spec = await settleAtom(
            store,
            appOpenApiSchemaAtomFamily(revision.id),
            (value) => value !== null,
        ).catch(() => null)
        const routePath = store.get(appRoutePathAtomFamily(revision.id)) || ""
        inputKeys = spec ? extractInputKeysFromSchema(spec as never, routePath) : []
        hasMessagesInput = spec
            ? Boolean(
                  extractAllEndpointSchemas(spec as never, routePath).primaryEndpoint
                      ?.messagesSchema,
              )
            : false
    } else {
        inputKeys = propertyNames(store.get(workflowMolecule.selectors.inputSchema(revision.id)))
    }

    const firstPage = await fetchTestcasesPage({
        projectId,
        revisionId: testset.revisionId,
        limit: 1,
    })
    const columns = Object.keys(firstPage.testcases[0]?.data ?? {}).filter(
        (column) => !column.startsWith("__"),
    )

    const resolvedEvaluators = await Promise.all(
        evaluators.map(async (evaluator) => {
            const entity = await settleAtom(
                store,
                workflowMolecule.selectors.data(evaluator.revisionId),
                (value) => Boolean(value),
            )
            const slug = await settleAtom(
                store,
                workflowMolecule.selectors.artifactSlug(evaluator.revisionId),
                (value) => Boolean(value),
            )
            return {
                revisionId: evaluator.revisionId,
                workflowId: entity?.workflow_id ?? evaluator.evaluatorId,
                variantId: entity?.workflow_variant_id ?? null,
                slug: slug ?? "",
                outputKeys: evaluatorOutputKeys(
                    entity?.data as Record<string, unknown> | undefined,
                ),
            }
        }),
    )

    return {
        name,
        testset: {
            id: testset.testsetId,
            name: testset.name,
            revisionId: testset.revisionId,
            columns,
        },
        revision: {
            id: revision.id,
            name: revision.variantName,
            workflowId: revisionEntity?.workflow_id ?? null,
            variantId: revisionEntity?.workflow_variant_id ?? null,
        },
        inputKeys,
        hasMessagesInput,
        evaluators: resolvedEvaluators,
    }
}
