import {useState} from "react"

import {
    AgentOperationsSkeleton,
    BooleanToggleControl,
    CodeConfigControl,
    CollapsibleProviderGroup,
    EnumSelectControl,
    FieldsTagsEditorControl,
    GroupedChoiceControl,
    HookConfigControl,
    JsonObjectEditor,
    NumberSliderControl,
    SectionDrawer,
    SectionQuickAction,
    SubSectionHeader,
    TextInputControl,
} from "@agenta/entity-ui/drill-in"
import {HeightCollapse} from "@agenta/ui"
import {CollapseToggleButton, Tag} from "@agenta/ui/components/presentational"
import {cn, textColors} from "@agenta/ui/styles"
import {
    Button,
    Combobox,
    Field,
    Input,
    SkeletonBlock,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {
    ArrowSquareOut,
    CaretDown,
    CopySimple,
    Info,
    Plugs,
    Plus,
    Trash,
    X,
} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Input as AntInput,
    InputNumber as AntInputNumber,
    Select as AntSelect,
    Skeleton as AntSkeleton,
    Slider as AntSlider,
    Switch as AntSwitch,
    Tag as AntTag,
    Tooltip as AntTooltip,
    Typography,
} from "antd"

const {Text} = Typography

// The DrillInView SchemaControls LEAVES (chunk G2): sixteen small, mostly presentational
// controls taken off antd onto @agenta/ui. Each row's antd half is the PRE-migration markup
// verbatim; only the swapped element differs, so a diff is the swap and nothing else.
// Shared wrappers that were ALREADY on @agenta/ui before this chunk (Field, RailField,
// SharedEditor, CollapseToggleButton, SimpleDropdownSelect) are used on both halves so they
// cancel out of the comparison.
const meta = {
    title: "@agenta/entity-ui/DrillIn/LeafControls",
    component: BooleanToggleControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Schema-control leaves. antd `Switch`/`Input`/`InputNumber`/`Slider`/`Select`/`Button`/`Tag`/`Tooltip`/`Skeleton`/`Typography` → `@agenta/ui` `Switch`/`Input`+`InputAffix`/`InputNumber`/`Slider`/`Combobox`+`MultiSelect`/`Button`/`Badge`+`Tag`/Radix `Tooltip`/`SkeletonBlock`/plain spans. `showSearch` selects become Combobox (Radix Select cannot search); `mode="multiple"` becomes the shared `MultiSelect` composite.',
            },
        },
    },
} satisfies Meta<typeof BooleanToggleControl>

export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// Grid convention (same as the wave-1 parity stories)
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

// ---------------------------------------------------------------------------
// Pre-migration (antd) replicas — copied verbatim from each file before the swap
// ---------------------------------------------------------------------------

/** BooleanToggleControl, pre-migration. */
const AntdBooleanToggle = ({
    label,
    checked,
    disabled,
    hint,
}: {
    label: string
    checked: boolean
    disabled?: boolean
    hint?: string
}) => (
    <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
            <Text className={cn("font-medium text-xs", textColors.primary)}>{label}</Text>
            {hint ? (
                <AntTooltip title={hint} placement="right">
                    <Info size={12} className="text-gray-400 cursor-help" aria-hidden="true" />
                </AntTooltip>
            ) : null}
        </div>
        <AntSwitch
            disabled={disabled}
            checked={checked}
            size="small"
            className="flex-shrink-0"
            aria-label={label}
        />
    </div>
)

/** NumberSliderControl, pre-migration. */
const AntdNumberSlider = ({
    label,
    value,
    min = 0,
    max = 1,
    step = 0.1,
    disabled,
    allowClear = true,
}: {
    label: string
    value: number | null
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    allowClear?: boolean
}) => (
    <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
            <Text className={cn("font-medium", textColors.primary)}>{label}</Text>
            <div className="flex items-center gap-1">
                <AntInputNumber
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    disabled={disabled}
                    style={{width: 70}}
                    aria-label={label}
                />
                {allowClear && value !== null && (
                    <AntButton
                        icon={<X size={14} />}
                        type="text"
                        size="small"
                        disabled={disabled}
                        aria-label={`Reset ${label}`}
                    />
                )}
            </div>
        </div>
        <AntSlider
            min={min}
            max={max}
            step={step}
            value={value ?? min}
            disabled={disabled}
            className="!my-0"
        />
    </div>
)

/** FieldsTagsEditorControl, pre-migration. */
const AntdFieldsTagsEditor = ({fields, disabled}: {fields: string[]; disabled?: boolean}) => (
    <Field label="Fields" tooltip="JSON field paths to compare">
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-md border border-solid border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] min-h-[32px]">
                <AntTooltip title="Aggregate score across all fields (auto-generated)">
                    <AntTag
                        color="success"
                        className="font-mono text-xs !m-0 !leading-tight !py-0.5 !px-1.5"
                    >
                        aggregate_score
                    </AntTag>
                </AntTooltip>
                {fields.map((field) => (
                    <AntTag
                        key={field}
                        closable={!disabled}
                        className="flex items-center font-mono text-xs !m-0 !leading-tight !py-0.5 !px-1.5"
                    >
                        {field}
                    </AntTag>
                ))}
                {fields.length === 0 && (
                    <Text className="text-[var(--ant-color-text-secondary)] text-xs">
                        Add fields to compare
                    </Text>
                )}
            </div>
            {!disabled && (
                <div className="flex gap-2">
                    <AntInput
                        size="small"
                        className="flex-1 font-mono"
                        placeholder="Add field (e.g., name or user.address.city)"
                        aria-label="Add field"
                        suffix={
                            <AntTooltip title="Use dot notation for nested fields (e.g., user.name)">
                                <Text type="secondary" className="text-[11px]">
                                    ?
                                </Text>
                            </AntTooltip>
                        }
                    />
                    <AntButton size="small" icon={<Plus size={12} />} disabled>
                        Add
                    </AntButton>
                </div>
            )}
            <div className="flex items-start justify-between gap-3">
                <Text type="secondary" className="text-[11px] pt-0.5">
                    Each field creates a column with value 0 (no match) or 1 (match)
                </Text>
            </div>
        </div>
    </Field>
)

/** HookConfigControl, pre-migration. */
const AntdHookConfig = ({disabled}: {disabled?: boolean}) => (
    <div className="flex flex-col gap-4">
        <Field label="URL" direction="vertical">
            <AntInput
                placeholder="https://your-service"
                className="font-mono"
                value="https://hooks.example.com/run"
                disabled={disabled}
                aria-label="URL"
            />
        </Field>
        <Field label="Headers" direction="vertical">
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <AntInput
                        placeholder="Key"
                        aria-label="Header key"
                        className="basis-1/3 font-mono"
                        value="X-Token"
                        disabled={disabled}
                    />
                    <AntInput
                        placeholder="Value"
                        aria-label="Header value"
                        className="basis-2/3 font-mono"
                        value="abc123"
                        disabled={disabled}
                    />
                    <AntButton
                        type="text"
                        size="small"
                        icon={<Trash size={14} />}
                        disabled={disabled}
                        aria-label="Remove header"
                    />
                </div>
                <AntButton
                    variant="outlined"
                    color="default"
                    size="small"
                    icon={<Plus size={14} />}
                    disabled={disabled}
                    className="self-start"
                >
                    Header
                </AntButton>
            </div>
        </Field>
    </div>
)

/** CodeConfigControl's card header (the file's whole antd surface), pre-migration. */
const AntdScriptHeader = () => (
    <div className="w-full flex items-start justify-between py-1">
        <Text strong className="text-sm pl-2">
            Script
        </Text>
        <div className="flex items-center gap-1 shrink-0">
            <AntTooltip title="Copy">
                <AntButton
                    icon={<CopySimple size={14} />}
                    type="text"
                    size="small"
                    aria-label="Copy"
                />
            </AntTooltip>
            <CollapseToggleButton collapsed={false} onToggle={() => undefined} />
        </div>
    </div>
)

/** The migrated CodeConfigControl card header. */
const AgentaScriptHeader = () => (
    <div className="w-full flex items-start justify-between py-1">
        <span className="text-sm font-semibold pl-2 text-colorText">Script</span>
        <div className="flex items-center gap-1 shrink-0">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Copy">
                            <CopySimple size={14} />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy</TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <CollapseToggleButton collapsed={false} onToggle={() => undefined} />
        </div>
    </div>
)

/** sectionGroups `SubSectionHeader`, pre-migration. */
const AntdSubSectionHeader = ({label, count}: {label: string; count: number}) => (
    <div className="flex items-center gap-1.5 px-0.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
        <span>{label}</span>
        <AntTag bordered className="m-0 !px-1.5 !text-[10px] font-normal leading-[16px]">
            {count}
        </AntTag>
    </div>
)

/** sectionGroups `CollapsibleProviderGroup`, pre-migration. */
const AntdCollapsibleProviderGroup = ({
    name,
    countText,
    addLabel,
    children,
}: {
    name: string
    countText: string
    addLabel: string
    children: React.ReactNode
}) => (
    <div className="overflow-hidden rounded border border-solid border-[var(--ag-colorBorderSecondary)]">
        <div className="flex cursor-pointer items-center gap-2.5 bg-[var(--ag-colorFillQuaternary)] py-2 pl-3 pr-[21px] transition-colors hover:bg-[var(--ag-colorFillSecondary)]">
            <CaretDown size={12} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
            <Plugs size={20} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
            <span className="shrink-0 text-[11px] text-[var(--ag-colorTextTertiary)]">
                {countText}
            </span>
            <AntTooltip title={addLabel}>
                <AntButton type="text" icon={<Plus size={16} />} aria-label={addLabel} />
            </AntTooltip>
        </div>
        <HeightCollapse open>
            <div className="flex flex-col gap-0.5 px-1.5 pb-1.5 pt-1">{children}</div>
        </HeightCollapse>
    </div>
)

/** SectionQuickAction, pre-migration. */
const AntdSectionQuickAction = ({children}: {children: React.ReactNode}) => (
    <div className="flex flex-col gap-3">
        {children}
        <AntButton
            type="text"
            className="!h-auto w-fit !px-0 !text-xs !text-[var(--ag-colorPrimary)]"
            icon={<ArrowSquareOut size={13} />}
        >
            Detailed configuration
        </AntButton>
    </div>
)

/** SectionDrawer's footer strip, pre-migration. */
const AntdSectionDrawerFooter = () => (
    <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
            Draft — applies on save
        </span>
        <div className="flex shrink-0 items-center gap-2">
            <AntButton>Cancel</AntButton>
            <AntButton type="primary">Save</AntButton>
        </div>
    </div>
)

/** SectionDrawer's dirty-close confirm footer, pre-migration. */
const AntdConfirmFooter = () => (
    <div className="flex items-center justify-end gap-2">
        <AntButton>Keep editing</AntButton>
        <AntButton danger>Discard</AntButton>
        <AntButton type="primary">Save changes</AntButton>
    </div>
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NUMBER_SCHEMA = {type: "number", minimum: 0, maximum: 2, description: "Sampling temperature"}
const ENUM_SCHEMA = {
    type: "string",
    enum: ["json_object", "json_schema", "text"],
    description: "Response format",
}
const ENUM_OPTIONS = [
    {value: "json_object", label: "Json object"},
    {value: "json_schema", label: "Json schema"},
    {value: "text", label: "Text"},
]
const GROUPED_SCHEMA = {
    type: "string",
    title: "Region",
    choices: {americas: ["us-east-1", "us-west-2"], europe: ["eu-west-1"]},
}
const GROUPED_OPTIONS = [
    {
        label: "Americas",
        options: [
            {label: "us-east-1", value: "us-east-1"},
            {label: "us-west-2", value: "us-west-2"},
        ],
    },
    {label: "Europe", options: [{label: "eu-west-1", value: "eu-west-1"}]},
]
const TEXT_SCHEMA = {type: "string", maxLength: 120, description: "Short description"}
const LANGUAGE_OPTIONS = [
    {value: "javascript", label: "JavaScript"},
    {value: "python", label: "Python"},
    {value: "sql", label: "SQL"},
]

const noop = () => undefined

// ---------------------------------------------------------------------------
// Parity grid
// ---------------------------------------------------------------------------

function LeafControlsComparison() {
    const [toggle, setToggle] = useState(true)
    const [numeric, setNumeric] = useState<number | null>(0.7)
    const [enumValue, setEnumValue] = useState<string | null>("json_schema")
    const [grouped, setGrouped] = useState<string | null>("us-east-1")
    const [text, setText] = useState<string | null>("Summarise the ticket")
    const [fields, setFields] = useState<string[]>(["user.name", "order.total"])
    const [hook, setHook] = useState<Record<string, unknown>>({
        url: "https://hooks.example.com/run",
        headers: {"X-Token": "abc123"},
    })
    const [language, setLanguage] = useState<string | undefined>("javascript")

    return (
        <div className="flex max-w-[1100px] flex-col">
            {/* BooleanToggleControl */}
            <Row
                label="boolean toggle · on"
                a={<AntdBooleanToggle label="Stream" checked hint="Stream tokens as they arrive" />}
                s={
                    <BooleanToggleControl
                        label="Stream"
                        description="Stream tokens as they arrive"
                        value={toggle}
                        onChange={setToggle}
                    />
                }
            />
            <Row
                label="boolean toggle · off"
                a={<AntdBooleanToggle label="Stream" checked={false} />}
                s={
                    <BooleanToggleControl
                        label="Stream"
                        value={false}
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="boolean toggle · disabled"
                a={<AntdBooleanToggle label="Stream" checked disabled />}
                s={
                    <BooleanToggleControl
                        label="Stream"
                        value
                        disabled
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />

            {/* NumberSliderControl */}
            <Row
                label="number + slider · filled"
                a={<AntdNumberSlider label="Temperature" value={0.7} max={2} />}
                s={
                    <NumberSliderControl
                        schema={NUMBER_SCHEMA}
                        label="Temperature"
                        value={numeric}
                        onChange={setNumeric}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="number + slider · empty"
                a={<AntdNumberSlider label="Top P" value={null} />}
                s={
                    <NumberSliderControl
                        label="Top P"
                        value={null}
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="number + slider · disabled"
                a={<AntdNumberSlider label="Top P" value={0.4} disabled />}
                s={
                    <NumberSliderControl
                        label="Top P"
                        value={0.4}
                        disabled
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />

            {/* EnumSelectControl */}
            <Row
                label="enum select · filled"
                expected="antd `showSearch` Select → Combobox: same trigger geometry (selectTriggerVariants), but the trigger hosts a text input, so the caret/placeholder metrics come from the Combobox, not .ant-select"
                a={
                    <Field label="Format">
                        <AntSelect
                            value="json_schema"
                            options={ENUM_OPTIONS}
                            className="w-full"
                            size="small"
                            showSearch
                        />
                    </Field>
                }
                s={
                    <EnumSelectControl
                        schema={ENUM_SCHEMA}
                        label="Format"
                        value={enumValue}
                        onChange={setEnumValue}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="enum select · empty"
                a={
                    <Field label="Format">
                        <AntSelect
                            options={ENUM_OPTIONS}
                            placeholder="Select..."
                            className="w-full"
                            size="small"
                            showSearch
                        />
                    </Field>
                }
                s={
                    <EnumSelectControl
                        schema={ENUM_SCHEMA}
                        label="Format"
                        value={null}
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="enum select · disabled"
                a={
                    <Field label="Format">
                        <AntSelect
                            value="text"
                            options={ENUM_OPTIONS}
                            disabled
                            className="w-full"
                            size="small"
                            showSearch
                        />
                    </Field>
                }
                s={
                    <EnumSelectControl
                        schema={ENUM_SCHEMA}
                        label="Format"
                        value="text"
                        disabled
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="enum select · dropdown variant"
                expected="already on @agenta/ui before this chunk (SimpleDropdownSelect); listed so the variant appears in the inventory"
                a={
                    <EnumSelectControl
                        schema={ENUM_SCHEMA}
                        value="text"
                        variant="dropdown"
                        onChange={noop}
                        withTooltip={false}
                    />
                }
                s={
                    <EnumSelectControl
                        schema={ENUM_SCHEMA}
                        value="text"
                        variant="dropdown"
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />

            {/* GroupedChoiceControl */}
            <Row
                label="grouped choice"
                expected="antd `showSearch` grouped Select → grouped Combobox (same trigger ramp; group headings render in the portaled panel)"
                a={
                    <Field label="Region">
                        <AntSelect
                            value="us-east-1"
                            options={GROUPED_OPTIONS}
                            className="w-full"
                            size="small"
                            showSearch
                            optionFilterProp="label"
                        />
                    </Field>
                }
                s={
                    <GroupedChoiceControl
                        schema={GROUPED_SCHEMA}
                        label="Region"
                        value={grouped}
                        onChange={setGrouped}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="grouped choice · disabled"
                a={
                    <Field label="Region">
                        <AntSelect
                            value="us-east-1"
                            options={GROUPED_OPTIONS}
                            disabled
                            className="w-full"
                            size="small"
                            showSearch
                            optionFilterProp="label"
                        />
                    </Field>
                }
                s={
                    <GroupedChoiceControl
                        schema={GROUPED_SCHEMA}
                        label="Region"
                        value="us-east-1"
                        disabled
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />

            {/* TextInputControl */}
            <Row
                label="text input · filled"
                a={
                    <Field label="Name">
                        <AntInput value="Summarise the ticket" maxLength={120} aria-label="Name" />
                        <Text type="secondary" className="text-xs">
                            Max: 120
                        </Text>
                    </Field>
                }
                s={
                    <TextInputControl
                        schema={TEXT_SCHEMA}
                        label="Name"
                        value={text}
                        onChange={(v) => setText(v)}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="text input · empty + placeholder"
                a={
                    <Field label="Name">
                        <AntInput placeholder="Type a name" aria-label="Name" />
                    </Field>
                }
                s={
                    <TextInputControl
                        label="Name"
                        value={null}
                        placeholder="Type a name"
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="text input · multiline"
                a={
                    <Field label="Notes" gap="sm">
                        <AntInput.TextArea
                            value={"line one\nline two"}
                            rows={3}
                            className="resize-y"
                            aria-label="Notes"
                        />
                    </Field>
                }
                s={
                    <TextInputControl
                        label="Notes"
                        multiline
                        value={"line one\nline two"}
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />
            <Row
                label="text input · disabled"
                a={
                    <Field label="Name">
                        <AntInput value="locked" disabled aria-label="Name" />
                    </Field>
                }
                s={
                    <TextInputControl
                        label="Name"
                        value="locked"
                        disabled
                        onChange={noop}
                        withTooltip={false}
                    />
                }
            />

            {/* FieldsTagsEditorControl */}
            <Row
                label="fields tags editor · filled"
                expected="deliberate: the control's own `font-mono` never reached antd's inner <input>/suffix (antd bakes its font into cssinjs), so the field typed in Inter; InputAffix's inner input is `font-[inherit]`, so the author's mono now applies. Kept — a field for dot-notation paths is meant to be monospace."
                a={<AntdFieldsTagsEditor fields={["user.name", "order.total"]} />}
                s={
                    <FieldsTagsEditorControl
                        label="Fields"
                        description="JSON field paths to compare"
                        value={fields}
                        onChange={setFields}
                    />
                }
            />
            <Row
                label="fields tags editor · empty"
                expected="deliberate: the control's own `font-mono` never reached antd's inner <input>/suffix (antd bakes its font into cssinjs), so the field typed in Inter; InputAffix's inner input is `font-[inherit]`, so the author's mono now applies. Kept — a field for dot-notation paths is meant to be monospace."
                a={<AntdFieldsTagsEditor fields={[]} />}
                s={
                    <FieldsTagsEditorControl
                        label="Fields"
                        description="JSON field paths to compare"
                        value={[]}
                        onChange={noop}
                    />
                }
            />
            <Row
                label="fields tags editor · disabled"
                expected="deliberate: the control's own `font-mono` never reached antd's inner <input>/suffix (antd bakes its font into cssinjs), so the field typed in Inter; InputAffix's inner input is `font-[inherit]`, so the author's mono now applies. Kept — a field for dot-notation paths is meant to be monospace."
                a={<AntdFieldsTagsEditor fields={["user.name"]} disabled />}
                s={
                    <FieldsTagsEditorControl
                        label="Fields"
                        description="JSON field paths to compare"
                        value={["user.name"]}
                        disabled
                        onChange={noop}
                    />
                }
            />

            {/* HookConfigControl */}
            <Row
                label="hook config"
                a={<AntdHookConfig />}
                s={<HookConfigControl value={hook} onChange={setHook} />}
            />
            <Row
                label="hook config · disabled"
                a={<AntdHookConfig disabled />}
                s={
                    <HookConfigControl
                        value={{
                            url: "https://hooks.example.com/run",
                            headers: {"X-Token": "abc123"},
                        }}
                        disabled
                        onChange={noop}
                    />
                }
            />

            {/* CodeConfigControl */}
            <Row
                label="code config · card header"
                expected="only the card HEADER is compared — the body is the shared SharedEditor (lexical), identical on both halves and not part of this migration"
                a={<AntdScriptHeader />}
                s={<AgentaScriptHeader />}
            />

            {/* CodeBlockLanguageMenu */}
            <Row
                label="code-block language menu"
                expected="the picker's Lexical/portal harness is not reproduced (it needs an EditorProvider and fixed-position portals); this row compares the picker CHROME, which is the whole antd surface. antd `variant=borderless` Select + `popupMatchSelectWidth={false}` → ghost Combobox with an auto-width panel"
                a={
                    <div
                        className="rounded-md bg-[var(--ant-color-bg-elevated)] [&_.ant-select-selector]:!h-6 [&_.ant-select-selector]:!px-2 [&_.ant-select-selection-item]:!text-[11px] [&_.ant-select-selection-item]:!leading-6"
                        style={{fontFamily: "var(--ant-font-family)"}}
                    >
                        <AntSelect
                            showSearch
                            value="javascript"
                            placeholder="Plain text"
                            options={LANGUAGE_OPTIONS}
                            optionFilterProp="label"
                            popupMatchSelectWidth={false}
                            variant="borderless"
                            className="min-w-[96px]"
                        />
                    </div>
                }
                s={
                    <div
                        className="rounded-md bg-[var(--ant-color-bg-elevated)]"
                        style={{fontFamily: "var(--ant-font-family)"}}
                    >
                        <Combobox
                            aria-label="Code block language"
                            value={language}
                            placeholder="Plain text"
                            options={LANGUAGE_OPTIONS}
                            onChange={setLanguage}
                            variant="ghost"
                            className="h-6 min-w-[96px] text-[11px]"
                            contentClassName="w-auto min-w-[160px]"
                        />
                    </div>
                }
            />

            {/* sectionGroups */}
            <Row
                label="sub-section header"
                a={<AntdSubSectionHeader label="Connected apps" count={5} />}
                s={<SubSectionHeader label="Connected apps" count={5} />}
            />
            <Row
                label="collapsible provider group"
                a={
                    <AntdCollapsibleProviderGroup
                        name="Slack"
                        countText="2 active · 3 total"
                        addLabel="Add trigger"
                    >
                        <div className="px-2 py-1 text-xs">#general</div>
                    </AntdCollapsibleProviderGroup>
                }
                s={
                    <CollapsibleProviderGroup
                        name="Slack"
                        countText="2 active · 3 total"
                        open
                        onToggle={noop}
                        onAdd={noop}
                        addLabel="Add trigger"
                    >
                        <div className="px-2 py-1 text-xs">#general</div>
                    </CollapsibleProviderGroup>
                }
            />

            {/* JsonObjectEditor */}
            <Row
                label="json editor · error line"
                expected="only the error line is compared — the editor body is the shared SharedEditor, identical on both halves"
                a={
                    <Text type="danger" className="text-xs">
                        Invalid JSON
                    </Text>
                }
                s={<span className="text-xs text-error">Invalid JSON</span>}
            />

            {/* SectionDrawer */}
            <Row
                label="section drawer · footer"
                a={<AntdSectionDrawerFooter />}
                s={
                    <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                            Draft — applies on save
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button variant="outline">Cancel</Button>
                            <Button>Save</Button>
                        </div>
                    </div>
                }
            />
            <Row
                label="section drawer · confirm footer"
                expected="antd bare `danger` (no `type`) resolves to the default-outlined danger button → variant='destructive-outline'"
                a={<AntdConfirmFooter />}
                s={
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="outline">Keep editing</Button>
                        <Button variant="destructive-outline">Discard</Button>
                        <Button>Save changes</Button>
                    </div>
                }
            />

            {/* SectionQuickAction */}
            <Row
                label="section quick action"
                a={
                    <AntdSectionQuickAction>
                        <AntInput placeholder="sk-…" aria-label="API key" />
                    </AntdSectionQuickAction>
                }
                s={
                    <SectionQuickAction onOpenDetails={noop}>
                        <Input placeholder="sk-…" aria-label="API key" />
                    </SectionQuickAction>
                }
            />

            {/* AgentOperationsSections' skeleton */}
            <Row
                label="operations header count skeleton"
                expected="antd `Skeleton.Button` is deferred in @agenta/ui (Skeleton.md); the same 44×14 active block is composed from SkeletonBlock. Both halves run an INFINITE shimmer, so the screenshot samples two unrelated gradient phases — the residual ratio is animation phase, not geometry (geometry verified equal: 44×14, radius 6)"
                a={<AntSkeleton.Button active size="small" style={{width: 44, height: 14}} />}
                s={
                    <div className="flex">
                        <SkeletonBlock active className="h-3.5 w-11 shrink-0" />
                    </div>
                }
            />
        </div>
    )
}

export const AntdVsAgenta: Story = {
    render: () => <LeafControlsComparison />,
}

// ---------------------------------------------------------------------------
// Showcases — the surfaces whose bodies are shared (editors, drawers, sections)
// ---------------------------------------------------------------------------

/** The Hook (url + headers) section body. */
export const HookConfig: Story = {
    render: function HookConfigStory() {
        const [value, setValue] = useState<Record<string, unknown>>({
            url: "https://hooks.example.com/run",
            headers: {"X-Token": "abc123", "X-Env": "staging"},
        })
        return (
            <div className="max-w-[520px]">
                <HookConfigControl value={value} onChange={setValue} />
            </div>
        )
    },
}

/** The Code (script + runtime) section body — SharedEditor with the tool-card chrome. */
export const CodeConfig: Story = {
    render: function CodeConfigStory() {
        const [value, setValue] = useState<Record<string, unknown>>({
            runtime: "python",
            script: "def run(inputs):\n    return {'ok': True}\n",
        })
        return (
            <div className="max-w-[620px]">
                <CodeConfigControl value={value} onChange={setValue} />
            </div>
        )
    },
}

/** Raw-JSON object editor — valid, then the parse-error line. */
export const JsonEditor: Story = {
    render: () => (
        <div className="flex max-w-[620px] flex-col gap-6">
            <JsonObjectEditor value={{type: "builtin", name: "read"}} onChange={noop} />
            <JsonObjectEditor value={"{ not json"} onChange={noop} />
        </div>
    ),
}

/** The section drawer, open, with its Cancel/Save footer. */
export const SectionDrawerOpen: Story = {
    render: () => (
        <SectionDrawer
            open
            title="Model & harness"
            icon={<Info size={14} />}
            onCancel={noop}
            onSave={noop}
        >
            <div className="text-xs text-colorTextSecondary">Section body</div>
        </SectionDrawer>
    ),
}

/** Loading shape for the Triggers / Files operational regions. */
export const OperationsSkeleton: Story = {
    render: () => (
        <div className="max-w-[520px]">
            <AgentOperationsSkeleton sticky={false} />
        </div>
    ),
}

/** The quick-action body a section shows when required info is missing. */
export const QuickAction: Story = {
    render: () => (
        <div className="max-w-[420px]">
            <SectionQuickAction onOpenDetails={noop}>
                <Field label="Provider API key">
                    <Input placeholder="sk-…" />
                </Field>
            </SectionQuickAction>
        </div>
    ),
}

/** Grouped provider cards (collapsed + expanded) with the sub-section header. */
export const ProviderGroups: Story = {
    render: function ProviderGroupsStory() {
        const [open, setOpen] = useState<Record<string, boolean>>({slack: true, github: false})
        return (
            <div className="flex max-w-[520px] flex-col gap-2">
                <SubSectionHeader label="Connected apps" count={2} />
                <CollapsibleProviderGroup
                    name="Slack"
                    countText="2 active · 3 total"
                    open={open.slack}
                    onToggle={() => setOpen((p) => ({...p, slack: !p.slack}))}
                    onAdd={noop}
                    addLabel="Add trigger"
                    statusTag={<Tag tone="success" size="small" label="Connected" />}
                >
                    <div className="px-2 py-1 text-xs">#general</div>
                    <div className="px-2 py-1 text-xs">#alerts</div>
                </CollapsibleProviderGroup>
                <CollapsibleProviderGroup
                    name="GitHub"
                    countText="1 tool"
                    open={open.github}
                    onToggle={() => setOpen((p) => ({...p, github: !p.github}))}
                >
                    <div className="px-2 py-1 text-xs">create_issue</div>
                </CollapsibleProviderGroup>
            </div>
        )
    },
}

/** Every leaf that takes a `disabled` prop, in its disabled state. */
export const DisabledStates: Story = {
    render: () => (
        <div className="flex max-w-[520px] flex-col gap-4">
            <BooleanToggleControl label="Stream" value disabled onChange={noop} />
            <NumberSliderControl label="Temperature" value={0.7} disabled onChange={noop} />
            <EnumSelectControl
                schema={ENUM_SCHEMA}
                label="Format"
                value="text"
                disabled
                onChange={noop}
            />
            <TextInputControl label="Name" value="locked" disabled onChange={noop} />
            <FieldsTagsEditorControl
                label="Fields"
                value={["user.name"]}
                disabled
                onChange={noop}
            />
            <HookConfigControl value={{url: "https://x"}} disabled onChange={noop} />
            <SectionQuickAction onOpenDetails={noop} disabled>
                <Input placeholder="sk-…" aria-label="API key" disabled />
            </SectionQuickAction>
        </div>
    ),
}
