"use client"

import {useCallback, useEffect, useState} from "react"

import {useAtom} from "jotai"

import {webworkerAtom} from "./state"
import type {WorkerStatus, UseWebWorkerHookReturn, WorkerMessage} from "./types"

// Global listener management to prevent duplicate event listeners
let globalListener: ((event: MessageEvent) => void) | null = null
const messageHandlers = new Set<(message: any) => void>()

const useWebWorker = <T>(
    onMessage: (message: WorkerMessage<T>) => void,
    shouldListen = false,
): UseWebWorkerHookReturn<T> => {
    const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("idle")
    const [worker] = useAtom(webworkerAtom)
    const createWorkerMessage = useCallback(
        (type: string, payload: T): WorkerMessage<T> => ({
            type,
            payload,
        }),
        [],
    )

    const postMessageToWorker = useCallback(
        (message: WorkerMessage<T>): void => {
            if (worker) {
                setWorkerStatus("working")
                worker.postMessage(message)
            }
        },
        [worker],
    )

    const handleMessageFromWorker = useCallback(
        (message: WorkerMessage<T>): void => {
            onMessage(message)
            setWorkerStatus("idle")
        },
        [onMessage],
    )

    useEffect(() => {
        if (!shouldListen || !worker) return

        // Add this handler to the global set
        messageHandlers.add(handleMessageFromWorker)

        // Create global listener if it doesn't exist
        if (!globalListener) {
            globalListener = (event: MessageEvent) => {
                // Broadcast to all registered handlers
                messageHandlers.forEach((handler) => {
                    try {
                        handler(event.data)
                    } catch (error) {
                        console.error("Error in web worker message handler:", error)
                    }
                })
            }
            worker.addEventListener("message", globalListener)
        }

        return () => {
            // Remove this handler from the global set
            messageHandlers.delete(handleMessageFromWorker)

            // If no more handlers, remove the global listener
            if (messageHandlers.size === 0 && globalListener && worker) {
                worker.removeEventListener("message", globalListener)
                globalListener = null
            }
        }
    }, [worker, shouldListen, handleMessageFromWorker])

    return {postMessageToWorker, workerStatus, createWorkerMessage}
}

export default useWebWorker
export type {WorkerStatus, WorkerMessage}
