import {PropsWithChildren} from "react"

import {appRevisionSelectionConfig} from "@agenta/entities/appRevision"
import {
    evaluatorSelectionConfig,
    evaluatorRevisionSelectionConfig,
} from "@agenta/entities/evaluator"
import {testsetSelectionConfig} from "@agenta/entities/testset"
import {
    revisionModalAdapter,
    testsetModalAdapter,
    variantModalAdapter,
} from "@agenta/entity-ui/adapters"
import {initializeSelectionSystem} from "@agenta/entity-ui/selection"
import {useQueryClient} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import WebWorkerProvider from "../components/Playground/Components/WebWorkerProvider"
import AgSWRConfig from "../lib/api/SWRConfig"

import {SessionListener} from "./session"

// Initialize the selection system with all entity configs
// This must be called before any selection components are rendered
initializeSelectionSystem({
    testset: testsetSelectionConfig,
    appRevision: appRevisionSelectionConfig,
    evaluator: evaluatorSelectionConfig,
    evaluatorRevision: evaluatorRevisionSelectionConfig,
})

// Explicitly reference modal adapters so registration is not tree-shaken.
void testsetModalAdapter
void revisionModalAdapter
void variantModalAdapter

const HydrateAtoms = ({children}: PropsWithChildren) => {
    const queryClient = useQueryClient()
    useHydrateAtoms([[queryClientAtom, queryClient]])
    return children
}

const GlobalStateProvider = ({children}: PropsWithChildren) => {
    const sharedStore = getDefaultStore()
    return (
        <Provider store={sharedStore}>
            <AgSWRConfig>
                <HydrateAtoms>
                    <WebWorkerProvider>
                        <SessionListener />
                        {children}
                    </WebWorkerProvider>
                </HydrateAtoms>
            </AgSWRConfig>
        </Provider>
    )
}

export default GlobalStateProvider
