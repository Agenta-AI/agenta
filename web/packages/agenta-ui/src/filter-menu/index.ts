/**
 * @agenta/ui/filter-menu — a host-agnostic filter / sort / group popover.
 *
 * antd-free and entity-free on purpose: `web/mobile` bans antd and the desktop app has no shared
 * notion of what a row's options mean, so everything — options, icons, current values — arrives
 * as props. Omitting a section is how a consumer turns that control off.
 */
export {FilterMenu, type FilterMenuProps} from "./FilterMenu"
export {GroupMenu, type GroupMenuProps} from "./GroupMenu"
export {FilterMenuPanel} from "./FilterMenuPanel"
export {FilterMenuOptionList} from "./FilterMenuOptionList"
export type {
    FilterMenuAlign,
    FilterMenuBlock,
    FilterMenuOption,
    FilterMenuPlacementProps,
    FilterMenuSection,
    FilterMenuSide,
    FilterMenuTriggerProps,
} from "./types"
