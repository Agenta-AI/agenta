/** The address of one annotation queue under `base` (`/w/<workspace>/p/<project>`). */
export const queueHref = (base: string, queueId: string): string => `${base}/annotations/${queueId}`

/**
 * The queue on its Annotate tab, at `scenarioId` when given. `useQueueSessionRoute` reads these
 * query keys.
 */
export const queueAnnotateHref = (base: string, queueId: string, scenarioId?: string): string => {
    const scenario = scenarioId ? `&scenarioId=${encodeURIComponent(scenarioId)}` : ""
    return `${queueHref(base, queueId)}?view=annotate${scenario}`
}
