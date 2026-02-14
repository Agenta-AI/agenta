/**
 * Re-export the shared CollapseToggleButton from @agenta/ui.
 *
 * All collapse/expand toggle logic (icons, labels, hook) lives in
 * @agenta/ui/components/presentational/buttons/CollapseToggleButton
 * to prevent drift between components.
 */

export {
    CollapseToggleButton as default,
    CollapseToggleButton,
    useCollapseToggle,
    getCollapseIcon,
    getCollapseLabel,
    type CollapseToggleButtonProps,
    type UseCollapseToggleOptions,
    type UseCollapseToggleReturn,
} from "@agenta/ui/components/presentational"
