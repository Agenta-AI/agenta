import {useCallback, useEffect, useState} from "react"

import {useAtom} from "jotai"

import type {WorkerStatus, UseWebWorkerHookReturn, WorkerMessage} from "./types"
import {webworkerAtom} from "./state"

const useWebWorker = <T>(
    onMessage: (message: WorkerMessage<T>) => void,
    shouldListen: boolean = false,
): UseWebWorkerHookReturn<T> => {
    const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("idle")
    const [worker, setWorker] = useAtom(webworkerAtom)
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
        (event: MessageEvent<WorkerMessage<T>>): void => {
            onMessage(event.data)
            setWorkerStatus("idle")
        },
        [onMessage],
    )

    useEffect(() => {
        if (!shouldListen) return

        if (worker) {
            worker.addEventListener("message", handleMessageFromWorker)
        }

        return () => {
            if (worker) {
                worker.removeEventListener("message", handleMessageFromWorker)
            }
        }
    }, [worker, shouldListen, handleMessageFromWorker])

    return {postMessageToWorker, workerStatus, createWorkerMessage}
}

export default useWebWorker
export type {WorkerStatus, WorkerMessage}
