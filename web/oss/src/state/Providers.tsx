import {PropsWithChildren} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import WebWorkerProvider from "../components/Playground/Components/WebWorkerProvider"
import AgSWRConfig from "../lib/api/SWRConfig"

import {SessionListener} from "./session"

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
