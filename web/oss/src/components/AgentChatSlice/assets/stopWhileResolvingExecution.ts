export interface StopWhileResolvingExecutionParams {
    stop: () => void
    resolveExecutionId: () => Promise<string | undefined>
    cancelExecution: (executionId: string | undefined) => Promise<unknown>
}

export function createStopPendingGate() {
    let pendingSnapshot: Promise<void> | null = null

    const runAfterPendingStop = async <T>(action: () => Promise<T>): Promise<T> => {
        while (pendingSnapshot) await pendingSnapshot
        return action()
    }

    const stopWhileResolvingExecution = async ({
        stop,
        resolveExecutionId,
        cancelExecution,
    }: StopWhileResolvingExecutionParams): Promise<void> => {
        const executionId = resolveExecutionId().catch(() => undefined)
        let releaseSnapshot!: () => void
        const snapshotGate = new Promise<void>((resolve) => {
            releaseSnapshot = resolve
        })
        pendingSnapshot = snapshotGate

        const release = () => {
            if (pendingSnapshot === snapshotGate) pendingSnapshot = null
            releaseSnapshot()
        }

        try {
            stop()
            const expectedExecutionId = await executionId
            release()
            await cancelExecution(expectedExecutionId)
        } finally {
            release()
        }
    }

    return {runAfterPendingStop, stopWhileResolvingExecution}
}
