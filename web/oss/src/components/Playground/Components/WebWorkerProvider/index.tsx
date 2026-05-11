"use client"

/**
 * Web Worker Provider Component
 *
 * This component initializes the web worker once at a high level to prevent
 * multiple instances from being created when playground atoms are used
 * in multiple components.
 */

import {useEffect} from "react"

import {executionItemController} from "@agenta/playground"
import {useSetAtom} from "jotai"

import useWebWorker from "../../hooks/useWebWorker"

interface WebWorkerProviderProps {
    children: React.ReactNode
}

export const WebWorkerProvider = ({children}: WebWorkerProviderProps) => {
    const handleWebWorkerResult = useSetAtom(executionItemController.actions.handleWebWorkerResult)
    const setExecutionWorkerBridge = useSetAtom(
        executionItemController.actions.setExecutionWorkerBridge,
    )

    // Initialize web worker once at the provider level
    const {postMessageToWorker, createWorkerMessage} = useWebWorker(
        (message: any) => {
            try {
                if (message && typeof message === "object") {
                    if (message.type === "runVariantRowResult" && message.payload) {
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

    // Inject worker bridge into playground state
    useEffect(() => {
        setExecutionWorkerBridge({
            postMessageToWorker,
            createWorkerMessage,
        })

        return () => {
            setExecutionWorkerBridge(null)
        }
    }, [postMessageToWorker, createWorkerMessage, setExecutionWorkerBridge])

    return <>{children}</>
}

export default WebWorkerProvider
