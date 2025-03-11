import {TestResult} from "../../assets/utilities/transformer/types"

export type WorkerStatus = "idle" | "working"

export interface UseWebWorkerHookReturn<T> {
    postMessageToWorker: (message: WorkerMessage<T>) => void
    workerStatus: WorkerStatus
    createWorkerMessage: (type: string, payload: T) => WorkerMessage<T>
}

export interface WorkerMessage<
    T = {
        variant: EnhancedVariant
        rowId: string
        messageId: string
        result: TestResult
    },
> {
    type: string
    payload: T
}
