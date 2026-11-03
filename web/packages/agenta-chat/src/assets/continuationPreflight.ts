export type ResumeSessionContinuation = (sessionId: string) => Promise<boolean>

/**
 * Preserve one owner for the next session turn. If the API redelivered a saved approval,
 * abort before constructing or sending a competing direct runner invocation.
 */
export async function assertNoResumedSessionContinuation(
    resume: ResumeSessionContinuation,
    sessionId: string,
): Promise<void> {
    let resumed = false
    try {
        resumed = await resume(sessionId)
    } catch (error) {
        console.warn("[continuationPreflight] unavailable; continuing Send", error)
        return
    }
    if (!resumed) return
    throw new Error(
        JSON.stringify({
            status: {
                code: "continuation_resumed",
                message:
                    "A saved approval is resuming. Wait for it to finish, then try this message again.",
            },
        }),
    )
}

/** Run request construction only after the durable continuation has declined ownership. */
export async function prepareAfterContinuationPreflight<T>(
    resume: ResumeSessionContinuation,
    sessionId: string,
    prepare: () => Promise<T>,
): Promise<T> {
    await assertNoResumedSessionContinuation(resume, sessionId)
    return prepare()
}
