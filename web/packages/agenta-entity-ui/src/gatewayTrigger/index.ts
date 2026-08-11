/**
 * Gateway-trigger entity UI.
 *
 * Atom-driven drawer for browsing a connected integration's events and viewing
 * each event's `trigger_config` schema. State and data come from
 * `@agenta/entities/gatewayTrigger`; this layer is purely the UI. Mirrors
 * `gatewayTool`.
 */

export {default as TriggerCatalogDrawer} from "./drawers/TriggerCatalogDrawer"
export {default as TriggerConnectDrawer} from "./drawers/TriggerConnectDrawer"
export {default as TriggerEventsDrawer} from "./drawers/TriggerEventsDrawer"
export {default as TriggerSubscriptionDrawer} from "./drawers/TriggerSubscriptionDrawer"
export {default as TriggerScheduleDrawer} from "./drawers/TriggerScheduleDrawer"
export {default as TriggerDeliveriesDrawer} from "./drawers/TriggerDeliveriesDrawer"
export {default as ActiveToggle} from "./components/ActiveToggle"
export type {ActiveToggleProps} from "./components/ActiveToggle"

// Inner pieces exported for the Storybook parity harness (and any future host):
// presentational leaves of the schedule/subscription drawers.
export {ScheduleBuilderField} from "./drawers/ScheduleBuilderField"
export {MessageComposer} from "./drawers/schedule/MessageComposer"
export {WindowField} from "./drawers/schedule/WindowField"
export {RunInPlaygroundButton} from "./drawers/schedule/RunInPlaygroundButton"
export {RunSubscriptionButton} from "./drawers/subscription/RunSubscriptionButton"
export {EventSourcePicker, type SampledEvent} from "./drawers/shared/EventSourcePicker"
