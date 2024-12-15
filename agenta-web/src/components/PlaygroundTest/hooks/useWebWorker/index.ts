import {useCallback, useEffect, useRef, useState} from "react"
import type {WorkerStatus, UseWebWorkerHookReturn, WorkerMessage} from "./types"

const useWebWorker = <T>(
    onMessage: (message: WorkerMessage<T>) => void,
): UseWebWorkerHookReturn<T> => {
    const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("idle")

    const createWorkerMessage = useCallback(
        (type: string, payload: T): WorkerMessage<T> => ({
            type,
            payload,
        }),
        [],
    )

    const postMessageToWorker = useCallback((message: WorkerMessage<T>): void => {
        if (workerRef.current) {
            console.log("post message to worker!")
            setWorkerStatus("working")
            workerRef.current.postMessage(message)
        }
    }, [])

    const handleMessageFromWorker = useCallback(
        (event: MessageEvent<WorkerMessage<T>>): void => {
            console.log("Message from worker:", event.data)
            onMessage(event.data)
            setWorkerStatus("idle")
        },
        [onMessage],
    )
    const workerRef = useRef<Worker>()

    useEffect(() => {
        workerRef.current = new Worker(new URL("./assets/playground.worker.ts", import.meta.url))
        workerRef.current.onmessage = handleMessageFromWorker
        return () => {
            workerRef.current?.terminate()
        }
    }, [onMessage, handleMessageFromWorker])

    return {postMessageToWorker, workerStatus, createWorkerMessage}
}

export default useWebWorker
export type {WorkerStatus, WorkerMessage}
