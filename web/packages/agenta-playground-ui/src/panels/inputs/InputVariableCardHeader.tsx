import {
    isChatMessagesArray,
    inferLogicalType,
    ViewTypeSelect,
    type ExpectedType,
    type ViewOption,
    type ViewType,
} from "@agenta/entity-ui/view-types"
import {message} from "@agenta/ui/app-message"
import {TypeChip, type ChipVariant} from "@agenta/ui/type-chip"
import {Badge, Button, SimpleTooltip} from "@agenta/ui/ui"
import {CaretDown, CaretRight, CopySimple, Info} from "@phosphor-icons/react"

const EXPECTED_CHIP: Partial<Record<NonNullable<ExpectedType>, ChipVariant>> = {
    object: "json-object",
    array: "json-array",
    boolean: "boolean",
    number: "number",
    integer: "number",
    string: "string",
}

/** The chip of a card: messages first, then the declared type for an empty value, else the value's own type. */
const chipVariantFor = (value: unknown, expectedType?: ExpectedType): ChipVariant => {
    if (isChatMessagesArray(value)) return "messages"
    const isEmpty = value === undefined || value === null || value === ""
    if (isEmpty && expectedType && EXPECTED_CHIP[expectedType]) return EXPECTED_CHIP[expectedType]!
    return inferLogicalType(value) as ChipVariant
}

/** The text a copy puts on the clipboard: text as is, anything else as JSON. */
const copyText = (value: unknown): string => {
    if (value === undefined || value === null) return ""
    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

export interface InputVariableCardHeaderProps {
    name: string
    value: unknown
    expectedType?: ExpectedType
    helpText?: string
    /** The prompt uses this variable, the test case does not have it yet. */
    isDraft?: boolean
    mode: ViewType
    options: ViewOption[]
    onModeChange: (mode: ViewType) => void
    editable: boolean
    collapsed: boolean
    onToggleCollapsed: () => void
}

/** The top line of an input card: name, type, draft badge, help, copy, view switch, collapse. */
export const InputVariableCardHeader = ({
    name,
    value,
    expectedType,
    helpText,
    isDraft,
    mode,
    options,
    onModeChange,
    editable,
    collapsed,
    onToggleCollapsed,
}: InputVariableCardHeaderProps) => {
    const copy = () =>
        navigator.clipboard.writeText(copyText(value)).then(
            () => message.success("Copied"),
            () => message.error("Copy failed"),
        )

    return (
        <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-xs font-medium text-primary">{name}</span>
                <TypeChip variant={chipVariantFor(value, expectedType)} value={value} />
                {helpText ? (
                    <SimpleTooltip title={helpText} side="top">
                        <Info
                            size={12}
                            aria-label={`About ${name}`}
                            className="shrink-0 cursor-help text-muted-foreground"
                        />
                    </SimpleTooltip>
                ) : null}
                {isDraft ? (
                    <SimpleTooltip
                        title="New prompt variable · commit the workflow to publish it."
                        side="top"
                    >
                        <Badge variant="outlined" className="font-mono">
                            draft
                        </Badge>
                    </SimpleTooltip>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <SimpleTooltip title="Copy value" side="top">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Copy ${name}`}
                        onClick={copy}
                    >
                        <CopySimple />
                    </Button>
                </SimpleTooltip>
                <ViewTypeSelect
                    value={mode}
                    options={options}
                    onChange={onModeChange}
                    disabled={!editable}
                />
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
                    aria-expanded={!collapsed}
                    onClick={onToggleCollapsed}
                >
                    {collapsed ? <CaretRight /> : <CaretDown />}
                </Button>
            </div>
        </div>
    )
}
