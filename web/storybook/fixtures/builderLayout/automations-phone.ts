import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    triggerSchedule,
    triggerSectionIds,
    triggerSectionQueries,
    triggerSubscription,
} from "../gatewayTrigger"

/**
 * The Automations tab of "Support triage" on a phone (canvas frames M10 and M11): the weekday
 * schedule "Daily summary" and the Zendesk app trigger "New Zendesk ticket". The run history
 * reuses the fixture of the desktop flow (`builderLayout/automations.ts`).
 */

/** The automations of frame M10. `long` gives the schedule a name longer than one row. */
export function phoneAutomationQueries(scope: StoryScope, opts?: {long?: boolean}) {
    const ids = triggerSectionIds(scope)
    return triggerSectionQueries(scope, {
        integrationName: "Zendesk",
        schedules: [
            triggerSchedule(ids, {
                id: scope.id("sch-daily-summary"),
                name: opts?.long
                    ? "Daily summary of yesterday's billing and account tickets for the ops channel"
                    : "Daily summary",
                cron: "0 9 * * 1-5",
                message: "Summarize yesterday's support tickets and post the digest to #ops.",
            }),
        ],
        subscriptions: [
            triggerSubscription(ids, {
                id: scope.id("sub-zendesk"),
                name: "New Zendesk ticket",
                eventKey: "ZENDESK_TICKET_CREATED",
            }),
        ],
    })
}

/** No automation on the agent: the desktop empty state above "Add automation". */
export function phoneNoAutomationQueries(scope: StoryScope) {
    return triggerSectionQueries(scope, {integrationName: "Zendesk"})
}

/** The story args that scope the list to the fixture agent. */
export const phoneAutomationArgs = (scope: StoryScope) => ({
    revisionId: triggerSectionIds(scope).revisionId,
})
