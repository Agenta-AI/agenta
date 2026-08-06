import {PropsWithChildren} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Provider, getDefaultStore} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"
import dynamic from "next/dynamic"

import AgSWRConfig from "../lib/api/SWRConfig"

import UserListener from "./profile/UserListener"
import {SessionListener} from "./session"

// Defers the heavy playground/entity registration graph (selection adapters,
// workflow commit/archive bridge, web worker) into an async chunk so it stays
// out of the shared `_app` bundle. Mounted childless on first client paint.
const DeferredAppBoot = dynamic(() => import("./boot/DeferredAppBoot"), {ssr: false})

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
                    <SessionListener />
                    <UserListener />
                    <DeferredAppBoot />
                    {children}
                </HydrateAtoms>
            </AgSWRConfig>
        </Provider>
    )
}

export default GlobalStateProvider
