import {useState, type ReactNode} from "react"

import {RailField} from "@agenta/entity-ui/drawers/shared"
import {
    AutosizeTextarea,
    Button,
    Combobox,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Input as AntInput,
    Select as AntSelect,
    Switch as AntSwitch,
} from "antd"

// Imported from source: the DrillInView barrel does not re-export the parameter editor.
import {ParameterNodeEditor} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ParameterNodeEditor"
import {
    ITEM_TYPE_OPTIONS,
    TYPE_OPTIONS,
    type Schema,
    type Seg,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/schemaPaths"
import {ChipsInput} from "../../../packages/agenta-entity-ui/src/gatewayTool/components/schemaFormControls"

// ParameterNodeEditor — the right-hand detail of the tool-parameter master/detail editor: a
// stack of `RailField` rows for the ONE node selected in `ParameterTree`. The rows shown depend
// on the node's kind, so the BRANCH MATRIX stories below (scalar / enum'd scalar / boolean /
// object / scalar array / array-of-object / deep path) are the real inventory; the parity grid
// covers the controls themselves.
//
// antd swaps: `Input` → `@agenta/ui` `Input` (`onPressEnter` → an Enter `onKeyDown`);
// `Input.TextArea autoSize` → `@agenta/ui` `Select` (+ an explicit `aria-label`: a Radix Select
// trigger is `role="combobox"`, which is not named from its contents); the CLEARABLE Default
// select → `Combobox` (Radix Select has no `allowClear`), same call as SandboxPermissionControl;
// `Input.TextArea autoSize` → `AutosizeTextarea`;
// `Select mode="tags" open={false}` → `ChipsInput` (antd's `tokenSeparators` split moved to the
// call site's `changeEnum`); `Switch onChange` → `onCheckedChange`; `Button icon` → icon child.
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ParameterNodeEditor.tsx`
// inside the same (already-migrated) `RailField` chrome.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ParameterNodeEditor",
    component: ParameterNodeEditor,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Contextual editor for one JSON-Schema parameter node: Name / Type (+ Item type for arrays) / Allowed values + Default (scalars only) / Description / Required, plus an inline Add property for container nodes.",
            },
        },
    },
} satisfies Meta<typeof ParameterNodeEditor>

export default meta
type Story = StoryObj

const noop = () => undefined

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCHEMA: Schema = {
    type: "object",
    properties: {
        location: {type: "string", description: "City name"},
        unit: {type: "string", enum: ["celsius", "fahrenheit"], default: "celsius"},
        days: {type: "integer"},
        metric: {type: "boolean"},
        labels: {type: "array", items: {type: "string"}},
        filter: {
            type: "object",
            properties: {status: {type: "string"}, since: {type: "string"}},
            required: ["status"],
        },
        recipients: {
            type: "array",
            items: {
                type: "object",
                properties: {email: {type: "string"}, name: {type: "string"}},
                required: ["email"],
            },
        },
    },
    required: ["location", "unit"],
}

const DEEP_SCHEMA: Schema = {
    type: "object",
    properties: {
        filter: {
            type: "object",
            properties: {
                ranges: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {from: {type: "string"}},
                        required: ["from"],
                    },
                },
            },
        },
    },
}

// Live host: the editor writes whole `parameters` roots back, so the story owns the schema.
function EditorBox({
    initial = SCHEMA,
    path,
    disabled,
}: {
    initial?: Schema
    path: Seg[]
    disabled?: boolean
}) {
    const [schema, setSchema] = useState<Schema>(initial)
    const [selected, setSelected] = useState<Seg[]>(path)
    return (
        <div className="max-w-[560px] rounded-lg border border-solid border-colorBorderSecondary p-4">
            <ParameterNodeEditor
                schema={schema}
                path={selected}
                onChange={setSchema}
                onPathChange={setSelected}
                onAddChild={noop}
                disabled={disabled}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Branch matrix — one story per node kind (the rows differ per kind)
// ---------------------------------------------------------------------------

/** Plain string scalar: Name / Type / Allowed values / Default (input) / Description / Required. */
export const StringScalar: Story = {
    render: () => <EditorBox path={[{p: "location"}]} />,
}

/** Scalar with an `enum`: Allowed values holds chips and Default becomes a clearable select. */
export const EnumScalar: Story = {
    render: () => <EditorBox path={[{p: "unit"}]} />,
}

/** Integer: same rows as a string, but the Default input takes a decimal inputMode. */
export const IntegerScalar: Story = {
    render: () => <EditorBox path={[{p: "days"}]} />,
}

/** Boolean: not a scalar for enum/default purposes — those two rows disappear. */
export const BooleanNode: Story = {
    render: () => <EditorBox path={[{p: "metric"}]} />,
}

/** Scalar array: the Type row splits into `[type | item type]`. */
export const ScalarArray: Story = {
    render: () => <EditorBox path={[{p: "labels"}]} />,
}

/** Object: no enum/default rows, plus the inline "Add property" row with a child count. */
export const ObjectNode: Story = {
    render: () => <EditorBox path={[{p: "filter"}]} />,
}

/** Array-of-object: item type = object, and children live under the array's `items`. */
export const ArrayOfObject: Story = {
    render: () => <EditorBox path={[{p: "recipients"}]} />,
}

/** Deeper than 3 segments: the extra "switch to JSON" hint appears. */
export const DeepPath: Story = {
    render: () => (
        <EditorBox
            initial={DEEP_SCHEMA}
            path={[{p: "filter"}, {p: "ranges"}, {items: true}, {p: "from"}]}
        />
    ),
}

/** Read-only: every control takes the disabled skin. */
export const Disabled: Story = {
    render: () => <EditorBox path={[{p: "unit"}]} disabled />,
}

// ---------------------------------------------------------------------------
// Parity grid
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
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

// Mirrors the component's own Select markup (aria-label on the role=combobox trigger).
const TypeSelect = ({
    value,
    options,
    onChange,
    label,
}: {
    value: string
    options: {value: string; label: string}[]
    onChange: (v: string) => void
    label: string
}) => (
    <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue />
        </SelectTrigger>
        <SelectContent>
            {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                    {o.label}
                </SelectItem>
            ))}
        </SelectContent>
    </Select>
)

const ENUM_OPTIONS = [
    {value: "celsius", label: "celsius"},
    {value: "fahrenheit", label: "fahrenheit"},
]

function ControlsComparison() {
    const [name, setName] = useState("location")
    const [type, setType] = useState("string")
    const [itemType, setItemType] = useState("string")
    const [enumValues, setEnumValues] = useState<string[]>(["celsius", "fahrenheit"])
    const [def, setDef] = useState<string | undefined>("celsius")
    const [plainDef, setPlainDef] = useState("")
    const [description, setDescription] = useState("")
    const [required, setRequired] = useState(true)
    return (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="Name (mono input)"
                a={
                    <RailField label="Name" align="center">
                        <AntInput
                            className="font-mono"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="parameter_name"
                        />
                    </RailField>
                }
                s={
                    <RailField label="Name" align="center">
                        <Input
                            className="font-mono"
                            aria-label="Parameter name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="parameter_name"
                        />
                    </RailField>
                }
            />
            <Row
                label="Type select"
                a={
                    <RailField label="Type" align="center">
                        <AntSelect
                            className="w-full"
                            value={type}
                            options={TYPE_OPTIONS}
                            onChange={setType}
                        />
                    </RailField>
                }
                s={
                    <RailField label="Type" align="center">
                        <TypeSelect
                            value={type}
                            options={TYPE_OPTIONS}
                            onChange={setType}
                            label="Type"
                        />
                    </RailField>
                }
            />
            <Row
                label="Type + item type (array)"
                a={
                    <RailField label="Type" align="center">
                        <div className="grid grid-cols-2 gap-2">
                            <AntSelect
                                className="w-full"
                                value="array"
                                options={TYPE_OPTIONS}
                                onChange={noop}
                            />
                            <AntSelect
                                className="w-full"
                                value={itemType}
                                options={ITEM_TYPE_OPTIONS}
                                onChange={setItemType}
                            />
                        </div>
                    </RailField>
                }
                s={
                    <RailField label="Type" align="center">
                        <div className="grid grid-cols-2 gap-2">
                            <TypeSelect
                                value="array"
                                options={TYPE_OPTIONS}
                                onChange={noop}
                                label="Type"
                            />
                            <TypeSelect
                                value={itemType}
                                options={ITEM_TYPE_OPTIONS}
                                onChange={setItemType}
                                label="Item type"
                            />
                        </div>
                    </RailField>
                }
            />
            <Row
                label="Allowed values (tags)"
                expected="ChipsInput (the shared gatewayTool composed control) sizes its text input `min-w-[80px] flex-1`, so a full chip row pushes the caret onto a second line; antd's tags-mode search input is width-auto and stays inline. Layout property of ChipsInput, not of this call site."
                a={
                    <RailField label="Allowed values">
                        <AntSelect
                            mode="tags"
                            className="w-full"
                            value={enumValues}
                            onChange={setEnumValues}
                            tokenSeparators={[",", "\n"]}
                            placeholder="Any value — add to restrict"
                            open={false}
                            suffixIcon={null}
                        />
                    </RailField>
                }
                s={
                    <RailField label="Allowed values">
                        <ChipsInput
                            value={enumValues}
                            onChange={(v) => setEnumValues(v ?? [])}
                            placeholder="Any value — add to restrict"
                        />
                    </RailField>
                }
            />
            <Row
                label="Default (clearable select)"
                expected="antd `Select allowClear` → `Combobox` (Radix Select has no clear): the trigger is an input, so it also filters as you type. Same deliberate substitution SandboxPermissionControl made for its clearable knob."
                a={
                    <RailField label="Default" align="center">
                        <AntSelect
                            className="w-full"
                            value={def}
                            onChange={setDef}
                            options={ENUM_OPTIONS}
                            placeholder="No default"
                            allowClear
                        />
                    </RailField>
                }
                s={
                    <RailField label="Default" align="center">
                        <Combobox
                            value={def}
                            onChange={setDef}
                            options={ENUM_OPTIONS}
                            placeholder="No default"
                            allowClear
                            aria-label="Default value"
                            className="w-full"
                        />
                    </RailField>
                }
            />
            <Row
                label="Default (free input)"
                a={
                    <RailField label="Default" align="center">
                        <AntInput
                            value={plainDef}
                            onChange={(e) => setPlainDef(e.target.value)}
                            placeholder="No default"
                        />
                    </RailField>
                }
                s={
                    <RailField label="Default" align="center">
                        <Input
                            aria-label="Default value"
                            value={plainDef}
                            onChange={(e) => setPlainDef(e.target.value)}
                            placeholder="No default"
                        />
                    </RailField>
                }
            />
            <Row
                label="Description (autosize)"
                a={
                    <RailField label="Description">
                        <AntInput.TextArea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            autoSize={{minRows: 2, maxRows: 5}}
                            placeholder="What this parameter is for"
                        />
                    </RailField>
                }
                s={
                    <RailField label="Description">
                        <AutosizeTextarea
                            aria-label="Parameter description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            autoSize={{minRows: 2, maxRows: 5}}
                            placeholder="What this parameter is for"
                        />
                    </RailField>
                }
            />
            <Row
                label="Required switch"
                a={
                    <RailField label="Required" align="center">
                        <div className="flex items-center gap-2">
                            <AntSwitch checked={required} onChange={setRequired} />
                            <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                                The model must provide this parameter on every call.
                            </span>
                        </div>
                    </RailField>
                }
                s={
                    <RailField label="Required" align="center">
                        <div className="flex items-center gap-2">
                            <Switch
                                aria-label="Required"
                                checked={required}
                                onCheckedChange={setRequired}
                            />
                            <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                                The model must provide this parameter on every call.
                            </span>
                        </div>
                    </RailField>
                }
            />
            <Row
                label="Add property button"
                a={
                    <RailField label="Properties" align="center">
                        <div className="flex items-center gap-2">
                            <AntButton icon={<Plus size={13} />}>Add property</AntButton>
                            <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                                2 nested properties — edit them in the tree.
                            </span>
                        </div>
                    </RailField>
                }
                s={
                    <RailField label="Properties" align="center">
                        <div className="flex items-center gap-2">
                            <Button variant="outline">
                                <Plus size={13} />
                                Add property
                            </Button>
                            <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                                2 nested properties — edit them in the tree.
                            </span>
                        </div>
                    </RailField>
                }
            />
        </div>
    )
}

/** Every migrated control, antd beside its replacement, inside the shared RailField chrome. */
export const AntdVsAgenta: Story = {
    render: () => <ControlsComparison />,
}
