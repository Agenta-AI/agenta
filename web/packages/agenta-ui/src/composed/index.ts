/**
 * @agenta/ui/composed — components the kit builds from the `@agenta/ui/ui` primitives: controls
 * shadcn has no registry component for (InputNumber, Segmented, Cascader, TreeSelect, the
 * date-range and time pickers), compositions over one primitive (LoadingButton, SimpleTooltip,
 * InputAffix, EmptyState, SkeletonRows) and layout parts (RightPane, SplitPane, PageToolbar).
 */
export {BackLink} from "./controls/back-link"
export {PageToolbar} from "./layout/page-toolbar"
export {RightPane, RightPaneHost, type RightPaneProps} from "./layout/right-pane"
export {LoadingButton, type LoadingButtonProps} from "./controls/loading-button"
export {InputNumber, inputNumberVariants, type InputNumberProps} from "./controls/input-number"
export {
    InputAffix,
    SearchInput,
    PasswordInput,
    AutosizeTextarea,
    type InputAffixProps,
    type AutosizeTextareaProps,
} from "./controls/input-affix"
export {CarouselDots, type CarouselDotsProps} from "./controls/carousel-dots"
export {SimpleTooltip, type SimpleTooltipProps} from "./feedback/simple-tooltip"
export {
    CopyTooltip,
    type CopyTooltipProps,
    type CopyTooltipOverlayProps,
} from "./feedback/copy-tooltip"
export {Divider, type DividerProps} from "./layout/divider"
export {Cascader, type CascaderOption, type CascaderProps} from "./controls/cascader"
export {
    DateRangePicker,
    DateRangeCalendar,
    type DateRangeValue,
    type DateRangePickerProps,
    type DateRangeCalendarProps,
} from "./controls/date-range-picker"
export {TreeSelect, type TreeSelectOption, type TreeSelectProps} from "./controls/tree-select"
export {
    Notification,
    NotificationViewport,
    notificationPlacements,
    type NotificationProps,
    type NotificationPlacement,
    type NotificationType,
} from "./feedback/notification"
export {
    SplitPane,
    paneSlideHoldMs,
    usePaneSlide,
    paneSlideMs,
    PANE_SLIDE_MS,
    type SplitPaneProps,
} from "./layout/split-pane"
export {
    Segmented,
    segmentedTrackVariants,
    segmentedItemVariants,
    segmentedThumbVariants,
    type SegmentedProps,
    type SegmentedValue,
} from "./controls/segmented"
export {
    ChoiceSwitch,
    type ChoiceSwitchOption,
    type ChoiceSwitchProps,
} from "./controls/choice-switch"
export {EmptyState, type EmptyStateProps} from "./feedback/empty-state"
export {
    IconTile,
    iconTileVariants,
    type IconTileProps,
    type IconTileSize,
    type IconTileTone,
} from "./layout/icon-tile"
export {InlineConfirm, type InlineConfirmProps} from "./feedback/inline-confirm"
export {SkeletonRows, type SkeletonRowsProps} from "./feedback/skeleton-rows"
export {DateTimePicker, type DateTimePickerProps} from "./controls/date-time-picker"
export {TimePicker, type TimePickerProps} from "./controls/time-picker"
export {
    ItemViewTitle,
    ItemViewTitleSkeleton,
    type ItemViewTitleEditable,
    type ItemViewTitleProps,
} from "./layout/item-view-title"
