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
    useCollapseStyle,
    getCollapseIcon,
    getCollapseLabel,
    getCollapseStyle,
    DEFAULT_COLLAPSED_MAX_HEIGHT,
    type CollapseToggleButtonProps,
    type UseCollapseToggleOptions,
    type UseCollapseToggleReturn,
} from "@agenta/ui/components/presentational"
