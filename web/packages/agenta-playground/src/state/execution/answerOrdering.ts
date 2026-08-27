/**
 * Ordering for a parked interaction's answer: record the durable row, THEN release the resume.
 *
 * A resume starts a new turn, and a new turn's `cancelStaleInteractions` sweep cancels every row
 * still `pending`. Racing the two loses that race often enough to matter — the record can need
 * three round trips (cache miss, invalidate, refetch, POST) against the resume's one — and a lost
 * race cancels the very row being answered: the runner then finds nothing to consume, the answer
 * stores as abandoned, and the user's decision is gone.
 *
 * Both parked kinds go through here. A client tool releases by dispatching the resume itself; an
 * approval releases by flipping its part to `approval-responded`, which is what lets the AI SDK
 * dispatch. Either way the release is whatever can trigger a turn, so it waits for the row.
 *
 * The wait is capped: a wedged API must never strand the user's answer. On timeout the release
 * happens exactly as it did before, and a late record still lands if the sweep has not won.
 */

/** Long enough for the record's worst case (cache miss + refetch + POST), short enough that a
 * dead API costs the user one beat rather than the turn. */
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
