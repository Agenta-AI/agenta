export type WorkerStatus = "idle" | "working"

export interface UseWebWorkerHookReturn<T> {
    postMessageToWorker: (message: WorkerMessage<T>) => void
    workerStatus: WorkerStatus
    createWorkerMessage: (type: string, payload: T) => WorkerMessage<T>
}

export interface WorkerMessage<T = Record<string, unknown>> {
    type: string
    payload: T
}
