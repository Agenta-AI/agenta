import {PropsWithChildren} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {DevTools} from "jotai-devtools"
import {queryClientAtom} from "jotai-tanstack-query"

import WebWorkerProvider from "../components/Playground/Components/WebWorkerProvider"
import PlaygroundDerivedListener from "../components/Playground/state/PlaygroundDerivedListener"
import AgSWRConfig from "../lib/api/SWRConfig"

import AppListener from "./app/hooks"
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
            <DevTools />
            <AgSWRConfig>
                <HydrateAtoms>
                    <WebWorkerProvider>
                        <SessionListener />
                        <AppListener />
                        <PlaygroundDerivedListener />
                        {children}
                    </WebWorkerProvider>
                </HydrateAtoms>
            </AgSWRConfig>
        </Provider>
    )
}

export default GlobalStateProvider
