/**
 * @agenta/ui/ui — the shadcn primitives, re-skinned to the app theme via the shared --ag-*
 * token bridge, plus the small parts they share (`cn`, `MENU_ITEM`, `CollapseCaret`,
 * `FieldHelp`, `DialogScope`). Only shadcn registry components live here; components built
 * from them are in `@agenta/ui/composed`.
 */
export {Badge, badgeVariants, statusBadgeVariant, type BadgeProps, type BadgeVariant} from "./badge"
export {
    Button,
    buttonVariants,
    fromLegacyButton,
    type ButtonProps,
    type LegacyButtonSize,
    type LegacyButtonType,
} from "./button"
export {Input, Textarea, inputVariants, type InputProps, type TextareaProps} from "./input"
export {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupText,
    InputGroupInput,
} from "./input-group"
export {
    Select,
    SelectGroup,
    SelectValue,
    SelectTrigger,
    SelectContent,
    SelectLabel,
    SelectItem,
    SelectSeparator,
    selectTriggerVariants,
    type SelectTriggerProps,
} from "./select"
export {Popover, PopoverTrigger, PopoverAnchor, PopoverContent} from "./popover"
export {HoverCard, HoverCardContent, HoverCardTrigger} from "./hover-card"
export {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
    type TooltipShortcut,
} from "./tooltip"
export {Kbd, KbdGroup, kbdVariants, type KbdProps} from "./kbd"
export {MENU_ITEM, MENU_ITEM_INSET} from "./menu-item"
export {CollapseCaret, type CollapseCaretProps} from "./collapse-caret"
export {RadioGroup, RadioGroupItem, type RadioGroupProps} from "./radio-group"
export {
    Combobox,
    type ComboboxOption,
    type ComboboxOptionGroup,
    type ComboboxProps,
} from "./combobox"
export {Switch, type SwitchProps} from "./switch"
export {Slider} from "./slider"
export {Toaster} from "./toast"
export {Tabs, TabsList, TabsTrigger, TabsContent} from "./tabs"
export {Checkbox, type CheckboxProps} from "./checkbox"
export {Alert, alertVariants, type AlertProps} from "./alert"
export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuGroup,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuPortal,
} from "./dropdown-menu"
export {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from "./context-menu"
export {Accordion, AccordionItem, AccordionTrigger, AccordionContent} from "./accordion"
export {
    Skeleton,
    SkeletonAvatar,
    SkeletonBlock,
    skeletonBlockVariants,
    type SkeletonProps,
    type SkeletonAvatarProps,
    type SkeletonBlockProps,
} from "./skeleton"
export {
    Dialog,
    DialogTrigger,
    DialogPortal,
    DialogOverlay,
    DialogContent,
    DialogClose,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
} from "./dialog"
export {DialogScope, useDialogScope} from "./dialog-scope"
export {
    Command,
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandShortcut,
    CommandSeparator,
} from "./command"
export {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogPortal,
    AlertDialogOverlay,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
} from "./alert-dialog"
export {
    Sheet,
    SheetTrigger,
    SheetPortal,
    SheetOverlay,
    SheetContent,
    SheetClose,
    SheetTitle,
    SheetDescription,
    SheetHeader,
    SheetFooter,
    sheetVariants,
} from "./sheet"
export {Spinner, spinnerVariants, type SpinnerSize, type SpinnerProps} from "./spinner"
export {
    Progress,
    progressTrackVariants,
    progressBarVariants,
    progressTextVariants,
    type ProgressProps,
    type ProgressSize,
    type ProgressStatus,
} from "./progress"
export {
    Avatar,
    AvatarImage,
    AvatarFallback,
    AvatarBox,
    avatarVariants,
    type AvatarProps,
    type AvatarBoxProps,
    type AvatarSize,
} from "./avatar"
export {
    Empty,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription,
    EmptyContent,
    emptyMediaVariants,
} from "./empty"
export {Label} from "./label"
export {Field, fieldLabelVariants, type FieldProps} from "./field"
export {FieldHelp, type FieldHelpProps} from "./field-help"
export {
    Breadcrumb,
    BreadcrumbList,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbPage,
    BreadcrumbSeparator,
    BreadcrumbEllipsis,
} from "./breadcrumb"
export {Calendar, type CalendarProps} from "./calendar"
export {DatePicker, type DatePickerProps} from "./date-picker"
export {cn} from "./utils"
export {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    ChartLegend,
    ChartLegendContent,
    ChartStyle,
    type ChartConfig,
} from "./chart"
