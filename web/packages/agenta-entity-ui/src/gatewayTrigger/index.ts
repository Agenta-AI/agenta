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
export {default as TriggerDeliveriesDrawer} from "./drawers/TriggerDeliveriesDrawer"
export {default as ActiveToggle} from "./components/ActiveToggle"
export type {ActiveToggleProps} from "./components/ActiveToggle"

// Inner pieces exported for the Storybook parity harness (and any future host):
// presentational leaves of the schedule/subscription drawers.
export {
    ScheduleBuilderField,
    ScheduleBuilderPanel,
    useScheduleBuilder,
    type ScheduleBuilderControls,
} from "./drawers/ScheduleBuilderField"
export {MessageComposer} from "./drawers/schedule/MessageComposer"
export {WindowField} from "./drawers/schedule/WindowField"
export {RunInPlaygroundButton} from "./drawers/schedule/RunInPlaygroundButton"
export {RunSubscriptionButton} from "./drawers/subscription/RunSubscriptionButton"
export {EventSourcePicker, type SampledEvent} from "./drawers/shared/EventSourcePicker"
// The reference-family rules a rebind has to obey (`application_*` vs `workflow_*`, variant for
// "latest" vs revision for pinned). A host that rebinds a trigger outside this drawer needs them
// or it writes a binding the backend can't resolve.
export {
    buildTriggerReferences,
    EMPTY_BINDING,
    parseStoredBinding,
    type TriggerBinding,
} from "./drawers/shared/useTriggerBinding"
// SchemaForm keeps its state in a form instance the HOST owns (see the DELIBERATE RESIDUE note in
// SchemaForm.tsx). Re-exported so a host can prefill and read back `trigger_config` filters
// without taking a direct dependency on the engine.
export {useForm as useSchemaFormInstance} from "@rc-component/form"
