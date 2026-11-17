import {useState} from "react"

import {
    AgentOperationsSkeleton,
    BooleanToggleControl,
    CodeConfigControl,
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
import {CollapseToggleButton} from "@agenta/ui/components/presentational"
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
import {CopySimple, Info} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The DrillInView SchemaControls LEAVES: sixteen small, mostly presentational controls on
// @agenta/ui. `Variants` lists each leaf in its common states as a single column.
const meta = {
    title: "@agenta/entity-ui/DrillIn/LeafControls",
    component: BooleanToggleControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Schema-control leaves: toggle, number slider, enum and grouped selects, text input, fields tags editor, hook config, code config header, section drawer footers and the operations skeleton.",
            },
        },
    },
} satisfies Meta<typeof BooleanToggleControl>

export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// Grid convention
// ---------------------------------------------------------------------------

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <div className="flex-1">{children}</div>
        </div>
    </div>
)

/** The CodeConfigControl card header. */
const ScriptHeader = () => (
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NUMBER_SCHEMA = {type: "number", minimum: 0, maximum: 2, description: "Sampling temperature"}
const ENUM_SCHEMA = {
    type: "string",
    enum: ["json_object", "json_schema", "text"],
    description: "Response format",
}
const GROUPED_SCHEMA = {
    type: "string",
    title: "Region",
    choices: {americas: ["us-east-1", "us-west-2"], europe: ["eu-west-1"]},
}
const TEXT_SCHEMA = {type: "string", maxLength: 120, description: "Short description"}
const LANGUAGE_OPTIONS = [
    {value: "javascript", label: "JavaScript"},
    {value: "python", label: "Python"},
    {value: "sql", label: "SQL"},
]

const noop = () => undefined

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

function LeafControlsVariants() {
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
            <Row label="boolean toggle · on">
                <BooleanToggleControl
                    label="Stream"
                    description="Stream tokens as they arrive"
                    value={toggle}
                    onChange={setToggle}
                />
            </Row>
            <Row label="boolean toggle · off">
                <BooleanToggleControl
                    label="Stream"
                    value={false}
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>
            <Row label="boolean toggle · disabled">
                <BooleanToggleControl
                    label="Stream"
                    value
                    disabled
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>

            {/* NumberSliderControl */}
            <Row label="number + slider · filled">
                <NumberSliderControl
                    schema={NUMBER_SCHEMA}
                    label="Temperature"
                    value={numeric}
                    onChange={setNumeric}
                    withTooltip={false}
                />
            </Row>
            <Row label="number + slider · empty">
                <NumberSliderControl
                    label="Top P"
                    value={null}
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>
            <Row label="number + slider · disabled">
                <NumberSliderControl
                    label="Top P"
                    value={0.4}
                    disabled
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>

            {/* EnumSelectControl */}
            <Row label="enum select · filled">
                <EnumSelectControl
                    schema={ENUM_SCHEMA}
                    label="Format"
                    value={enumValue}
                    onChange={setEnumValue}
                    withTooltip={false}
                />
            </Row>
            <Row label="enum select · empty">
                <EnumSelectControl
                    schema={ENUM_SCHEMA}
                    label="Format"
                    value={null}
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>
            <Row label="enum select · disabled">
                <EnumSelectControl
                    schema={ENUM_SCHEMA}
                    label="Format"
                    value="text"
                    disabled
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>
            <Row label="enum select · dropdown variant">
                <EnumSelectControl
                    schema={ENUM_SCHEMA}
                    value="text"
                    variant="dropdown"
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>

            {/* GroupedChoiceControl */}
            <Row label="grouped choice">
                <GroupedChoiceControl
                    schema={GROUPED_SCHEMA}
                    label="Region"
                    value={grouped}
                    onChange={setGrouped}
                    withTooltip={false}
                />
            </Row>
            <Row label="grouped choice · disabled">
                <GroupedChoiceControl
                    schema={GROUPED_SCHEMA}
                    label="Region"
                    value="us-east-1"
                    disabled
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>

            {/* TextInputControl */}
            <Row label="text input · filled">
                <TextInputControl
                    schema={TEXT_SCHEMA}
                    label="Name"
                    value={text}
                    onChange={(v) => setText(v)}
                    withTooltip={false}
                />
            </Row>
            <Row label="text input · empty + placeholder">
                <TextInputControl
                    label="Name"
                    value={null}
                    placeholder="Type a name"
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>
            <Row label="text input · multiline">
                <TextInputControl
                    label="Notes"
                    multiline
                    value={"line one\nline two"}
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>
            <Row label="text input · disabled">
                <TextInputControl
                    label="Name"
                    value="locked"
                    disabled
                    onChange={noop}
                    withTooltip={false}
                />
            </Row>

            {/* FieldsTagsEditorControl */}
            <Row label="fields tags editor · filled">
                <FieldsTagsEditorControl
                    label="Fields"
                    description="JSON field paths to compare"
                    value={fields}
                    onChange={setFields}
                />
            </Row>
            <Row label="fields tags editor · empty">
                <FieldsTagsEditorControl
                    label="Fields"
                    description="JSON field paths to compare"
                    value={[]}
                    onChange={noop}
                />
            </Row>
            <Row label="fields tags editor · disabled">
                <FieldsTagsEditorControl
                    label="Fields"
                    description="JSON field paths to compare"
                    value={["user.name"]}
                    disabled
                    onChange={noop}
                />
            </Row>

            {/* HookConfigControl */}
            <Row label="hook config">
                <HookConfigControl value={hook} onChange={setHook} />
            </Row>
            <Row label="hook config · disabled">
                <HookConfigControl
                    value={{
                        url: "https://hooks.example.com/run",
                        headers: {"X-Token": "abc123"},
                    }}
                    disabled
                    onChange={noop}
                />
            </Row>

            {/* CodeConfigControl (card header only — the body is the shared SharedEditor) */}
            <Row label="code config · card header">
                <ScriptHeader />
            </Row>

            {/* CodeBlockLanguageMenu (picker chrome only) */}
            <Row label="code-block language menu">
                <div className="rounded-md">
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
            </Row>

            {/* sectionGroups */}
            <Row label="sub-section header">
                <SubSectionHeader label="Connected apps" count={5} />
            </Row>

            {/* JsonObjectEditor (error line only — the body is the shared SharedEditor) */}
            <Row label="json editor · error line">
                <span className="text-xs text-error">Invalid JSON</span>
            </Row>

            {/* SectionDrawer */}
            <Row label="section drawer · footer">
                <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        Draft — applies on save
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button variant="outline">Cancel</Button>
                        <Button>Save</Button>
                    </div>
                </div>
            </Row>
            <Row label="section drawer · confirm footer">
                <div className="flex items-center justify-end gap-2">
                    <Button variant="outline">Keep editing</Button>
                    <Button variant="destructive-outline">Discard</Button>
                    <Button>Save changes</Button>
                </div>
            </Row>

            {/* SectionQuickAction */}
            <Row label="section quick action">
                <SectionQuickAction onOpenDetails={noop}>
                    <Input placeholder="sk-…" aria-label="API key" />
                </SectionQuickAction>
            </Row>

            {/* AgentOperationsSections' skeleton */}
            <Row label="operations header count skeleton">
                <div className="flex">
                    <SkeletonBlock active className="h-3.5 w-11 shrink-0" />
                </div>
            </Row>
        </div>
    )
}

export const Variants: Story = {
    render: () => <LeafControlsVariants />,
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
