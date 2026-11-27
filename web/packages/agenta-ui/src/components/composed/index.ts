/**
 * @agenta/ui/composed — components the kit builds from the `@agenta/ui/ui` primitives: controls
 * shadcn has no registry component for (InputNumber, Segmented, Cascader, TreeSelect, the
 * date-range and time pickers), compositions over one primitive (LoadingButton, SimpleTooltip,
 * InputAffix, EmptyState, SkeletonRows) and layout parts (RightPane, SplitPane, PageToolbar).
 */
export {BackLink} from "./back-link"
export {PageToolbar} from "./page-toolbar"
export {RightPane, RightPaneHost, type RightPaneProps} from "./right-pane"
export {LoadingButton, type LoadingButtonProps} from "./loading-button"
export {InputNumber, inputNumberVariants, type InputNumberProps} from "./input-number"
export {
    InputAffix,
    SearchInput,
    PasswordInput,
    AutosizeTextarea,
    type InputAffixProps,
    type AutosizeTextareaProps,
} from "./input-affix"
export {CarouselDots, type CarouselDotsProps} from "./carousel-dots"
export {SimpleTooltip, type SimpleTooltipProps} from "./simple-tooltip"
export {Divider, type DividerProps} from "./divider"
export {Cascader, type CascaderOption, type CascaderProps} from "./cascader"
export {
    DateRangePicker,
    DateRangeCalendar,
    type DateRangeValue,
    type DateRangePickerProps,
    type DateRangeCalendarProps,
} from "./date-range-picker"
export {TreeSelect, type TreeSelectOption, type TreeSelectProps} from "./tree-select"
export {
    Notification,
    NotificationViewport,
    notificationPlacements,
    type NotificationProps,
    type NotificationPlacement,
    type NotificationType,
} from "./notification"
export {
    SplitPane,
    paneSlideHoldMs,
    usePaneSlide,
    paneSlideMs,
    PANE_SLIDE_MS,
    type SplitPaneProps,
} from "./split-pane"
export {
    Segmented,
    segmentedTrackVariants,
    segmentedItemVariants,
    segmentedThumbVariants,
    type SegmentedProps,
    type SegmentedValue,
} from "./segmented"
export {ChoiceSwitch, type ChoiceSwitchOption, type ChoiceSwitchProps} from "./choice-switch"
export {EmptyState, type EmptyStateProps} from "./empty-state"
export {
    IconTile,
    iconTileVariants,
    type IconTileProps,
    type IconTileSize,
    type IconTileTone,
} from "./icon-tile"
export {InlineConfirm, type InlineConfirmProps} from "./inline-confirm"
export {SkeletonRows, type SkeletonRowsProps} from "./skeleton-rows"
export {DateTimePicker, type DateTimePickerProps} from "./date-time-picker"
export {TimePicker, type TimePickerProps} from "./time-picker"
export {
    ItemViewTitle,
    ItemViewTitleSkeleton,
    type ItemViewTitleEditable,
    type ItemViewTitleProps,
} from "./item-view-title"
