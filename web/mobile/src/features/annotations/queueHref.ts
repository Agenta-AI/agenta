/**
 * The address of one annotation queue under `base` (`/w/<workspace>/p/<project>`). With
 * `annotate`, it opens the Annotate tab, at `scenarioId` when given. `useQueueSessionRoute` reads
 * these query keys.
 */
export const queueHref = (
    base: string,
    queueId: string,
    annotate?: {scenarioId?: string},
): string => {
    const path = `${base}/annotations/${queueId}`
    if (!annotate) return path
    const scenario = annotate.scenarioId
        ? `&scenarioId=${encodeURIComponent(annotate.scenarioId)}`
        : ""
    return `${path}?view=annotate${scenario}`
}
