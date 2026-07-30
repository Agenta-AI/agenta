/**
 * Module-level configuration, cross-component atoms and the revision adapter for the
 * subscription drawer. Kept local to the drawer — the schedule drawer declares its own
 * knobs with its own semantics.
 */
import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {atom} from "jotai"

import {createWorkflowRevisionAdapter} from "../../../selection"

// How many unsaved drafts can exist at once (config knob; see schedule drawer).
export const MAX_DRAFTS = 5
// Show the master-detail list rail (existing triggers + "New trigger"). Hidden for now —
// the playground opens straight to a single form; flip back to true to restore the list.
export const SHOW_LIST_RAIL = false

// The active form publishes its source-browse state here so the single drawer header can go
// "smart" (back + "Choose a trigger") without lifting browse state out of the form.
export const browseHeaderAtom = atom<{onBack: () => void} | null>(null)
// The master-detail content publishes whether the open form is a SAVED subscription (vs a new
// draft) so the root title reads "Edit trigger" after a create switches to the saved id —
// `state.subscriptionId` alone stays undefined in the playground create flow.
export const subscriptionEditingAtom = atom(false)
// Default maps the whole event context under `context`; `$` resolves to the full context.
export const DEFAULT_INPUTS_MAPPING = '{"context": "$"}'

// The bound reference is always `application_*`, so the picker only offers application
// workflows (is_application=True).
export const applicationRevisionAdapter = createWorkflowRevisionAdapter({
    workflowListAtom: appWorkflowsListQueryStateAtom,
})
