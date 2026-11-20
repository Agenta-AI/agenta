import type {Automation} from "@agenta/automation-ui"
import type {TriggerDelivery} from "@agenta/entities/gatewayTrigger"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

/**
 * The automation "Daily summary" of canvas sheet F05 (frames f6 to f9): a weekday schedule with
 * twelve runs in 30 days, one test capture, one skipped run and one failed run.
 */

export const AUTOMATION_ID = "sch-daily-summary"
export const INSTRUCTION = "Summarize yesterday's support tickets and post the digest to #ops."

export const DAILY_SUMMARY = {
    id: AUTOMATION_ID,
    kind: "schedule",
    name: "Daily summary",
    description: "",
    agentId: "agent-support-triage",
    isActive: true,
    cron: "0 9 * * 1-5",
    eventKey: null,
    connectionId: null,
    updatedAt: null,
    raw: {
        id: AUTOMATION_ID,
        data: {inputs_fields: {message: INSTRUCTION}, schedule: "0 9 * * 1-5"},
    },
} as unknown as Automation

const at = (daysAgo: number, hour: number, minute = 0) => {
    const date = new Date()
    date.setDate(date.getDate() - daysAgo)
    date.setHours(hour, minute, 0, 0)
    return date.toISOString()
}

const run = (
    n: number,
    createdAt: string,
    extra: Partial<TriggerDelivery> & {data?: Record<string, unknown>} = {},
): TriggerDelivery =>
    ({
        id: `delivery-${n}`,
        event_id: `event-${n}`,
        schedule_id: AUTOMATION_ID,
        created_at: createdAt,
        updated_at: createdAt,
        status: {code: "200", message: "success"},
        data: {session_id: `session-${n}`},
        ...extra,
    }) as TriggerDelivery

export const RUNS: TriggerDelivery[] = [
    run(1, at(0, 9)),
    run(2, at(0, 8, 41), {data: {is_test: true}}),
    run(3, at(1, 9)),
    run(4, at(3, 9)),
    run(5, at(6, 9), {
        status: {code: "200", message: "skipped"},
        data: {},
    }),
    run(6, at(7, 9)),
    run(7, at(8, 9), {status: {code: "500", message: "failed"}}),
    run(8, at(9, 9)),
    run(9, at(10, 9)),
    run(10, at(13, 9)),
    run(11, at(14, 9)),
    run(12, at(15, 9)),
]

const owner = (scope: StoryScope) => [scope.projectId, "schedule", AUTOMATION_ID] as const

/** Query cache entries: the capped recent read (the count line) and the paged run list. */
export function runHistoryQueries(scope: StoryScope, runs: TriggerDelivery[] = RUNS) {
    return [
        [
            ["triggers", "deliveries", "recent", ...owner(scope)],
            {count: runs.length, deliveries: runs},
        ],
        [
            ["triggers", "deliveries", "pages", ...owner(scope)],
            {pages: [{count: runs.length, deliveries: runs}], pageParams: [undefined]},
        ],
    ] as [readonly unknown[], unknown][]
}
