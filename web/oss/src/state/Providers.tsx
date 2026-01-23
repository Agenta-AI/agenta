import {PropsWithChildren} from "react"

import {appRevisionSelectionConfig} from "@agenta/entities/appRevision"
import {testsetSelectionConfig} from "@agenta/entities/testset"
import {initializeSelectionSystem} from "@agenta/entities/ui"
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
})

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
