// Answer a parked interaction: record the durable row, THEN release whatever can start a turn.
// A new turn's stale sweep cancels every `pending` row, the answered one included, so the two must
// be ordered. Both kinds route here: a client tool releases its resume, an approval its part flip.

/** Capped so a wedged API costs the user one beat rather than stranding the answer for good. */
export const RECORD_ANSWER_TIMEOUT_MS = 2_000

export const recordAnswerThenRelease = async ({
    record,
    release,
    timeoutMs = RECORD_ANSWER_TIMEOUT_MS,
}: {
    record: () => Promise<unknown>
    release: () => void
    timeoutMs?: number
}): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([
            // `record` is best-effort and documented never to reject; the catch is belt and braces
            // so a future change there can never swallow the release.
            Promise.resolve()
                .then(record)
                .catch(() => undefined),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, timeoutMs)
            }),
        ])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
    release()
}
