"use client"

/**
 * Web Worker Provider Component
 *
 * This component initializes the web worker once at a high level to prevent
 * multiple instances from being created when usePlaygroundAtoms is used
 * in multiple components.
 */

import {useEffect} from "react"

import {useSetAtom} from "jotai"

import {handleWebWorkerResultAtom} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

import useWebWorker from "../../hooks/useWebWorker"

interface WebWorkerProviderProps {
    children: React.ReactNode
}

export const WebWorkerProvider = ({children}: WebWorkerProviderProps) => {
    const handleWebWorkerResult = useSetAtom(handleWebWorkerResultAtom)

    // Initialize web worker once at the provider level
    const {postMessageToWorker, createWorkerMessage} = useWebWorker(
        (message: any) => {
            try {
                if (message && typeof message === "object") {
                    if (message.type === "runVariantInputRowResult" && message.payload) {
                        handleWebWorkerResult(message.payload)
                        return
                    }
                    // Optional: handle ping/pong or errors
                    if (message.type === "error") {
                        console.error("[WW] error message", message.payload)
                        return
                    }
                }

                console.debug("[WW] unhandled message", message)
            } catch (e) {
                console.error("[WW] handler failure", e)
            }
        },
        true, // Enable listening for messages
    )

    // Store web worker functions globally for access by atoms
    useEffect(() => {
        // Store the web worker functions in a global object for access by atoms
        ;(window as any).__playgroundWebWorker = {
            postMessageToWorker,
            createWorkerMessage,
        }

        return () => {
            // Clean up on unmount
            delete (window as any).__playgroundWebWorker
        }
    }, [postMessageToWorker, createWorkerMessage])

    return <>{children}</>
}

export default WebWorkerProvider
