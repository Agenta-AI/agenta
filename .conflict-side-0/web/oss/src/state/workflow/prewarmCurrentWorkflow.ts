import {
    workflowDetailQueryAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
} from "@agenta/entities/workflow"
import {getDefaultStore} from "jotai"

import {appIdentifiersAtom} from "@/oss/state/appState"
import {registerBootPrewarmTask} from "@/oss/state/boot/prewarmBootQueryGraph"

const noop = () => undefined

let registered = false

// Fire the current app's detail + latest-revision fetches in the boot burst (their gates —
// session, projectId, appId — are all URL-derived), instead of waiting for PlaygroundRouter
// to mount behind the auth gates + chunk parse, which serializes two round-trips.
export const prewarmCurrentWorkflowQueries = () => {
    if (registered || typeof window === "undefined") return
    registered = true
    registerBootPrewarmTask(() => {
        const appId = getDefaultStore().get(appIdentifiersAtom).appId
        if (!appId) return
        getDefaultStore().sub(workflowDetailQueryAtomFamily(appId), noop)
        getDefaultStore().sub(workflowLatestRevisionQueryAtomFamily(appId), noop)
    })
}
