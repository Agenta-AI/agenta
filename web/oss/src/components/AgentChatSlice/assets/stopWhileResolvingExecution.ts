export interface StopPinnedExecutionParams {
    stop: () => void
    expectedExecutionId: string | undefined
    cancelExecution: (executionId: string | undefined) => Promise<unknown>
}

export async function stopPinnedExecution({
    stop,
    expectedExecutionId,
    cancelExecution,
}: StopPinnedExecutionParams): Promise<void> {
    stop()
    await cancelExecution(expectedExecutionId)
}
