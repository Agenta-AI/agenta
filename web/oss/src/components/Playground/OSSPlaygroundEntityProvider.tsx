/**
 * OSS Playground Entity Provider
 *
 * Wires OSS-specific entity implementations (workflowMolecule)
 * into the package's PlaygroundEntityProvider.
 *
 * Follows the same pattern as OSSdrillInUIProvider for DrillInView.
 */

import {useEffect, useMemo, type ReactNode} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {
    PlaygroundEntityProvider,
    type PlaygroundEntityProviders,
    executionItemController,
} from "@agenta/playground"
import {useSetAtom} from "jotai"

import {getJWT} from "@/oss/services/api"

// Side-effect: registers selection callback and workflow commit/archive callbacks
import "@/oss/state/newPlayground/workflowEntityBridge"

const ossEntityProviders: PlaygroundEntityProviders = {
    // Workflow entity (modern /preview/workflows/ API)
    // Handles both app and evaluator workflows via flags
    workflow: {
        selectors: {
            data: (id: string) => workflowMolecule.selectors.data(id),
            query: (id: string) => workflowMolecule.selectors.query(id),
            isDirty: (id: string) => workflowMolecule.selectors.isDirty(id),
        },
    },
}

/** Stable ref: returns auth headers for worker HTTP requests */
const getAuthHeaders = async () => {
    const jwt = await getJWT()
    return jwt ? {Authorization: `Bearer ${jwt}`} : {}
}

export function OSSPlaygroundEntityProvider({children}: {children: ReactNode}) {
    const providers = useMemo(() => ossEntityProviders, [])
    const setHeaders = useSetAtom(executionItemController.actions.setExecutionHeaders)
    // Register the auth headers provider once on mount
    useEffect(() => {
        setHeaders(() => getAuthHeaders)
    }, [setHeaders])

    return <PlaygroundEntityProvider providers={providers}>{children}</PlaygroundEntityProvider>
}
