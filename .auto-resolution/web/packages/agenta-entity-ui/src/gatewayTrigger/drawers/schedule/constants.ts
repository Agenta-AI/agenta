/**
 * Module-level configuration and the revision adapter for the schedule drawer. Kept local
 * to the drawer — the subscription drawer declares its own knobs with its own semantics.
 */
import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"

import {createWorkflowRevisionAdapter} from "../../../selection"

// Weekly (Monday 09:00 UTC) so the builder opens on the Weekly cadence by default.
export const DEFAULT_CRON = "0 9 * * 1"
// How many unsaved drafts can exist at once. Set to 1 for single-draft behavior
// (the "New schedule" button disables while a draft is active); raise for multiple
// staged drafts. Purely a config knob — no other logic depends on the value.
export const MAX_DRAFTS = 5
// Show the master-detail list rail (existing schedules + "New schedule"). Hidden for now —
// the playground opens straight to a single form; flip back to true to restore the list.
export const SHOW_LIST_RAIL = false
// A schedule fires a synthetic tick; there is no provider event, but the data
// model still requires an `event_key`. We use a stable schedule-tick key.
export const SCHEDULE_EVENT_KEY = "schedule.tick"

// Schedules bind the `application_*` reference family (same as subscriptions),
// so the picker only offers application workflows (is_application=True).
export const applicationRevisionAdapter = createWorkflowRevisionAdapter({
    workflowListAtom: appWorkflowsListQueryStateAtom,
})
