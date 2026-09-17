/**
 * Revision ids the agent committed in this transcript, in stream order, one per part. The
 * backend emits a one-way `data-committed-revision` part on the stream whenever the agent
 * commits itself, whether the tool asked first or ran directly.
 */
export const committedRevisionIds = (messages: {parts: unknown[]}[]): string[] => {
    const ids: string[] = []
    for (const message of messages) {
        for (const part of message.parts) {
            const candidate = part as {type?: string; data?: {revisionId?: string}}
            if (candidate.type !== "data-committed-revision") continue
            const revisionId = candidate.data?.revisionId
            if (revisionId && !ids.includes(revisionId)) ids.push(revisionId)
        }
    }
    return ids
}
