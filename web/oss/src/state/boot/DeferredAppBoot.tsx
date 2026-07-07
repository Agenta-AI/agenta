/**
 * Deferred app boot — loaded once via `next/dynamic({ssr:false})` from
 * `GlobalStateProvider` so the heavy playground/entity graph it registers
 * (`@agenta/entities/workflow`, `@agenta/entities/testset`, `@agenta/playground`,
 * the web worker) lands in an async chunk instead of the shared `_app` chunk.
 *
 * Everything here is a runtime registration consumed at user-action time
 * (selection adapters via a Map, workflow commit/archive callbacks, the worker
 * bridge), so it only has to land before the first relevant interaction — not
 * before render. Mounted on first client paint to win that race.
 */

import {useEffect} from "react"

import {evaluatorSelectionConfig} from "@agenta/entities/workflow"
import {
    revisionModalAdapter,
    simpleQueueModalAdapter,
    testsetModalAdapter,
    variantModalAdapter,
} from "@agenta/entity-ui/adapters"
import {initializeSelectionSystem} from "@agenta/entity-ui/selection"
import {executionItemController} from "@agenta/playground"
import {useSetAtom} from "jotai"

import WebWorkerProvider from "@/oss/components/Playground/Components/WebWorkerProvider"
import {getJWT} from "@/oss/services/api"

// Side-effect: registers selection callback and workflow commit/archive callbacks.
import "@/oss/state/newPlayground/workflowEntityBridge"

// Register entity selection adapters before any selection component is used.
// The testset adapter is auto-registered by initializeSelectionSystem; only the
// evaluator adapter needs runtime config.
initializeSelectionSystem({
    evaluator: evaluatorSelectionConfig,
})

// Explicitly reference modal adapters so registration is not tree-shaken.
void testsetModalAdapter
void revisionModalAdapter
void simpleQueueModalAdapter
void variantModalAdapter

/** Stable ref: returns auth headers for worker HTTP requests */
const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const jwt = await getJWT()
    return jwt ? {Authorization: `Bearer ${jwt}`} : {}
}

const DeferredAppBoot = () => {
    // Register auth headers provider once globally for playground execution workers.
    const setHeaders = useSetAtom(executionItemController.actions.setExecutionHeaders)
    useEffect(() => {
        setHeaders(() => getAuthHeaders)
    }, [setHeaders])

    return <WebWorkerProvider />
}

export default DeferredAppBoot
