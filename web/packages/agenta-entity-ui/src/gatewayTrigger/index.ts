/**
 * Gateway-trigger entity UI.
 *
 * Atom-driven drawer for browsing a connected integration's events and viewing
 * each event's `trigger_config` schema. State and data come from
 * `@agenta/entities/gatewayTrigger`; this layer is purely the UI. Mirrors
 * `gatewayTool`.
 */

export {default as TriggerEventsDrawer} from "./drawers/TriggerEventsDrawer"
