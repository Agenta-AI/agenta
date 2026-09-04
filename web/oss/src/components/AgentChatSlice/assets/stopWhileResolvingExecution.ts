export interface StopWhileResolvingExecutionParams {
    stop: () => void
    resolveExecutionId: () => Promise<string | undefined>
    cancelExecution: (executionId: string | undefined) => Promise<unknown>
}

export async function stopWhileResolvingExecution({
    stop,
    resolveExecutionId,
    cancelExecution,
}: StopWhileResolvingExecutionParams): Promise<void> {
    const executionId = resolveExecutionId().catch(() => undefined)
    stop()
    await cancelExecution(await executionId)
}
