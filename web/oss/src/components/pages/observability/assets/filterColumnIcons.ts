/**
 * Desktop's icon set for the filter field menu.
 *
 * The column table itself lives in `@agenta/observability/filters` as pure
 * metadata; each host overlays its own icons by node label so the table can be
 * shared with surfaces that use a different icon library.
 */
import type {FilterColumnIcons} from "@agenta/observability"
import {
    ArrowBendRightDownIcon,
    ArrowBendRightUpIcon,
    Chats,
    CoinsIcon,
    GearFineIcon,
    LightningIcon,
    MagnifyingGlassIcon,
    PencilIcon,
    PlusCircleIcon,
    SpinnerIcon,
    TimerIcon,
    TreeStructureIcon,
    TreeViewIcon,
    WarningOctagonIcon,
} from "@phosphor-icons/react"

export const FILTER_COLUMN_ICONS: FilterColumnIcons = {
    "Text search": MagnifyingGlassIcon,
    "Input Key": ArrowBendRightDownIcon,
    "Output Key": ArrowBendRightUpIcon,
    Trace: TreeStructureIcon,
    Span: TreeViewIcon,
    Session: Chats,
    "Duration (ms)": TimerIcon,
    "Cost ($)": CoinsIcon,
    Tokens: PlusCircleIcon,
    Annotation: PencilIcon,
    Status: SpinnerIcon,
    Exception: WarningOctagonIcon,
    Reference: GearFineIcon,
    Custom: LightningIcon,
}
