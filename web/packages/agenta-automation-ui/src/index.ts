/**
 * @agenta/automation-ui — the automations surface, as components rather than as a screen.
 *
 * One automation is a schedule OR an event subscription: two entities on two endpoints that a
 * reader has no reason to tell apart. Everything here works in those terms — `Automation` is the
 * shape both map onto, and the field stack edits either kind through the same controls.
 *
 * Host-free by contract: nothing in this package imports a router, an app shell, or a chat
 * session. What needs those is a slot the app fills (`actions` on the detail body, the run
 * transcript pane), which is what lets the same field stack serve `/m`'s screens and the
 * playground's drawer.
 */

// The model: what an automation is, and how an edit becomes a request body.
export * from "./automationModel"
export * from "./automationListView"
export * from "./automationEdit"
export * from "./runModel"
export * from "./templates"

// Data: the entity hooks, already scoped to a project by the host's binding.
export {useAutomation} from "./useAutomation"
export {useAutomations} from "./useAutomations"
export {useAutomationRuns} from "./useAutomationRuns"
export {useAutomationStats, STATS_WINDOW_DAYS, type AutomationStats} from "./useAutomationStats"
export {useAutomationDraft} from "./useAutomationDraft"

// One drawer for both kinds — what the playground mounts in place of its two forms.
export {AutomationDrawer} from "./AutomationDrawer"
export {AutomationCreateBody} from "./AutomationCreateBody"
export {useAutomationCreate, DEFAULT_CRON, DRAFT_ID} from "./useAutomationCreate"
export type {AutomationCreateState, AutomationDraft} from "./useAutomationCreate"
export {useAutomationEditor} from "./useAutomationEditor"

// The editing surface.
export {AutomationDetailBody} from "./AutomationDetailBody"
export {AutomationField} from "./AutomationField"
export {AutomationAgentField} from "./AutomationAgentField"
export {AutomationRunsWhenField} from "./AutomationRunsWhenField"
export {AutomationInstructionField} from "./AutomationInstructionField"
export {AutomationTitle} from "./AutomationTitle"
export {AutomationMetaRow} from "./AutomationMetaRow"
export {AutomationSaveBar} from "./AutomationSaveBar"
export {AutomationBackLink} from "./AutomationBackLink"
export {AutomationFailureBanner} from "./AutomationFailureBanner"
export {AutomationRunHistoryCard} from "./AutomationRunHistoryCard"
export {AutomationRunHistoryView} from "./AutomationRunHistoryView"
export {AutomationStatCards} from "./AutomationStatCards"
export {AutomationTemplateCard} from "./AutomationTemplateCard"
export {AutomationTriggerDrawers} from "./AutomationTriggerDrawers"

// Run history.
export {AutomationRunList} from "./AutomationRunList"
export {AutomationRunPane} from "./AutomationRunPane"
export {AutomationRunRow} from "./AutomationRunRow"

// The "Runs when" event picker, and the empty/error/loading shapes.
export {EventPickerPanel, type EventSelection} from "./pickers/EventPickerPanel"
export {PickerOverlay} from "./pickers/PickerOverlay"
export * from "./states/AutomationStates"
export * from "./states/AutomationRunStates"
