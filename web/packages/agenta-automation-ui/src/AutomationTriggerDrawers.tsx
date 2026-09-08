import {TriggerCatalogDrawer} from "@agenta/entity-ui/gatewayTrigger"

/**
 * The integration catalog drawer the "Connect another app…" row opens, atom-driven.
 *
 * Mounted by the SCREEN rather than by the picker, the way `SessionAutomationDrawers` mounts the
 * session drawers: opening it closes the popover (a sheet on a phone), and a drawer owned by that
 * popover would be torn down in the same breath. The connections query invalidates itself once a
 * connection lands, so the app rail picks it up on its own.
 */
export const AutomationTriggerDrawers = () => <TriggerCatalogDrawer />
