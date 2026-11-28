/**
 * How often the people who reviewed a run's automatic evaluators agreed with them: the overview's
 * "Evaluator agreement" tile and the Scenarios table's "Reviews" column read it. Counts the
 * saved reviews (`readJudgeReview`); there is no stored metric. Pure: no request.
 *
 * @packageDocumentation
 */

import type {JudgeVerdict} from "./judgeReview"

export interface ReviewAgreement {
    agreed: number
    total: number
    /** Judges with at least one "disagree", most first (ties by name). */
    disagreementsByJudge: {judge: string; count: number}[]
}

/** Count the reviews: agreed of all, and the disagreements of each judge. */
export function reviewAgreement(
    reviews: readonly {judge: string; verdict: JudgeVerdict}[],
): ReviewAgreement {
    const byJudge = new Map<string, number>()
    let agreed = 0
    for (const {judge, verdict} of reviews) {
        if (verdict === "agree") agreed += 1
        else byJudge.set(judge, (byJudge.get(judge) ?? 0) + 1)
    }
    return {
        agreed,
        total: reviews.length,
        disagreementsByJudge: [...byJudge]
            .map(([judge, count]) => ({judge, count}))
            .sort((a, b) => b.count - a.count || a.judge.localeCompare(b.judge)),
    }
}
