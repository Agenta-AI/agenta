import {
    AutosizeTextarea,
    Input as ShadInput,
    InputAffix,
    PasswordInput,
    SearchInput,
    Textarea,
} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input as AntInput} from "antd"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Input",
    component: ShadInput,
    subcomponents: {InputAffix, PasswordInput, SearchInput, Textarea, AutosizeTextarea},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Input family (cva-based) that replaces antd `Input`. Includes affix, password, search, and textarea variants — see the subcomponent tables below.\n\n**Used in:** bare `Input` in 9 places (`SharedEditor`, `EditableText`, `LabelInput`, the drill-in controls, the LLM provider picker, the editor form nodes, the markdown toolbar). The composed variants ship wider: `SearchInput` in 7 (entity picker variants, table search), `AutosizeTextarea` in 5 (`SharedEditor`, `CommitMessageInput`, `LabelInput`, the editor primitive node), `InputAffix` in 5 (upload pills, column-visibility search). `PasswordInput` has a single call-site (`LabelInput`) and bare `Textarea` only backs `AutosizeTextarea`.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Inputs are width:100% — their width is the container's, not the component's. Each side
// gets an identical fixed-width box so `width` measures the component rather than how far
// a too-narrow flex cell squeezed it below min-content.
const CONTROL_BOX = "w-[220px] shrink-0"

// data-vrt-subject on the sizing box: affix rows hold >1 subject candidate, pin the whole box.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">antd</span>
            <div className={CONTROL_BOX} data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">agenta</span>
            <div className={CONTROL_BOX} data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex flex-col max-w-[900px]">
            <Row
                label="default"
                a={<AntInput placeholder="text" />}
                s={<ShadInput placeholder="text" />}
            />
            <Row
                label="filled"
                a={<AntInput variant="filled" placeholder="text" />}
                s={<ShadInput variant="filled" placeholder="text" />}
            />
            <Row
                label="borderless → ghost"
                a={<AntInput variant="borderless" placeholder="text" />}
                s={<ShadInput variant="ghost" placeholder="text" />}
            />
            <Row
                label="small → sm"
                a={<AntInput size="small" placeholder="s" />}
                s={<ShadInput size="sm" placeholder="s" />}
            />
            <Row
                label="large → lg"
                a={<AntInput size="large" placeholder="l" />}
                s={<ShadInput size="lg" placeholder="l" />}
            />
            <Row
                label="disabled"
                a={<AntInput disabled placeholder="d" />}
                s={<ShadInput disabled placeholder="d" />}
            />
            <Row
                label="status=error → aria-invalid"
                a={<AntInput status="error" placeholder="e" />}
                s={<ShadInput aria-invalid placeholder="e" />}
            />
            <Row
                label="prefix → InputAffix"
                a={<AntInput prefix={<MagnifyingGlass size={14} />} placeholder="search" />}
                s={
                    <InputAffix
                        aria-label="Field"
                        prefix={<MagnifyingGlass size={14} />}
                        placeholder="search"
                    />
                }
            />
            <Row
                label="allowClear → InputAffix"
                a={<AntInput allowClear defaultValue="clear me" />}
                s={<InputAffix aria-label="Field" allowClear defaultValue="clear me" />}
            />
            {/*
             * SearchInput reproduces a prefixed+clearable input, NOT antd's Input.Search —
             * antd's Search adds a trailing search *button*, which we deliberately dropped.
             * Compared against the equivalent antd shape; the dropped button is a real (small)
             * visual change at the one call-site that used it (useTableManager). See Input.md.
             */}
            <Row
                label="SearchInput (vs prefixed input)"
                a={
                    <AntInput
                        prefix={<MagnifyingGlass size={14} />}
                        allowClear
                        placeholder="search"
                    />
                }
                s={<SearchInput placeholder="search" />}
            />
            <Row
                label="antd Input.Search (has a trailing button — not reproduced)"
                a={<AntInput.Search placeholder="search" />}
                s={<SearchInput placeholder="search" />}
            />
            <Row
                label="Input.Password → PasswordInput"
                a={<AntInput.Password defaultValue="hunter2" />}
                s={<PasswordInput aria-label="Password" defaultValue="hunter2" />}
            />
            <Row
                label="textarea"
                a={<AntInput.TextArea rows={2} placeholder="ta" />}
                s={<Textarea rows={2} placeholder="ta" />}
            />
            <Row
                label="autoSize → AutosizeTextarea"
                a={<AntInput.TextArea autoSize={{minRows: 2, maxRows: 6}} placeholder="grows" />}
                s={<AutosizeTextarea autoSize={{minRows: 2, maxRows: 6}} placeholder="grows" />}
            />
        </div>
    ),
}

// Interaction states rendered statically via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-focus-all` / `pseudo-hover-all`, which forces that pseudo-class on the
// input inside — measurable with getComputedStyle, no cursor. antd input focus is CSS `:focus`.
const StateRow = ({
    label,
    pseudo,
    a,
    s,
}: {
    label: string
    pseudo: string
    a: React.ReactNode
    s: React.ReactNode
}) => (
    <div className="grid grid-cols-[14rem_auto_auto] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {/* subject ON the pseudo wrapper so the crop keeps the forced state */}
            <div className={`${pseudo} ${CONTROL_BOX}`} data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className={`${pseudo} ${CONTROL_BOX}`} data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            {/* focus-within (not focus): the glow is gated on :focus-within so it also fires on
                the affix wrapper when its inner <input> is focused. On a bare <input> the two
                are equivalent. Force with pseudo-focus-within-all, not pseudo-focus-all. */}
            <StateRow
                label="default · focus"
                pseudo="pseudo-focus-within-all"
                a={<AntInput defaultValue="text" />}
                s={<ShadInput defaultValue="text" />}
            />
            <StateRow
                label="filled · focus"
                pseudo="pseudo-focus-within-all"
                a={<AntInput variant="filled" defaultValue="text" />}
                s={<ShadInput variant="filled" defaultValue="text" />}
            />
            <StateRow
                label="error · focus"
                pseudo="pseudo-focus-within-all"
                a={<AntInput status="error" defaultValue="text" />}
                s={<ShadInput aria-invalid defaultValue="text" />}
            />
            <StateRow
                label="affix · focus-within (inner input focused)"
                pseudo="pseudo-focus-within-all"
                a={<AntInput prefix={<MagnifyingGlass />} defaultValue="text" />}
                s={
                    <InputAffix
                        aria-label="Field"
                        prefix={<MagnifyingGlass />}
                        defaultValue="text"
                    />
                }
            />
            <StateRow
                label="default · hover"
                pseudo="pseudo-hover-all"
                a={<AntInput defaultValue="text" />}
                s={<ShadInput defaultValue="text" />}
            />
        </div>
    ),
}
