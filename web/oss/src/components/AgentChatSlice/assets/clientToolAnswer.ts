/**
 * Ordering for a client-tool answer: record the durable row, THEN dispatch the resume.
 *
 * The resume starts a new turn, and a new turn's `cancelStaleInteractions` sweep cancels every
 * row still `pending`. Racing the two loses that race often enough to matter — the record can
 * need three round trips (cache miss, invalidate, refetch, POST) against the resume's one — and
 * a lost race stores an answered card as abandoned, which is the whole bug this project fixes.
 *
 * The wait is capped: a wedged API must never strand the user's answer. On timeout the resume
 * goes out exactly as it did before, and a late record still lands if the sweep has not won.
 */

/** Long enough for the record's worst case (cache miss + refetch + POST), short enough that a
 * dead API costs the user one beat rather than the turn. */
export const RECORD_ANSWER_TIMEOUT_MS = 2_000

export const recordAnswerThenResume = async ({
    record,
    resume,
    timeoutMs = RECORD_ANSWER_TIMEOUT_MS,
}: {
    record: () => Promise<unknown>
    resume: () => void
    timeoutMs?: number
}): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([
            // `record` is best-effort and documented never to reject; the catch is belt and braces
            // so a future change there can never swallow the resume.
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
    resume()
}
