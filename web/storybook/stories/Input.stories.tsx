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

const meta = {
    title: "@agenta/ui/Primitives/Forms/Input",
    component: ShadInput,
    subcomponents: {InputAffix, PasswordInput, SearchInput, Textarea, AutosizeTextarea},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Input family (cva-based). Includes affix, password, search, and textarea variants — see the subcomponent tables below.\n\n**Used in:** bare `Input` in 9 places (`SharedEditor`, `EditableText`, `LabelInput`, the drill-in controls, the LLM provider picker, the editor form nodes, the markdown toolbar). The composed variants ship wider: `SearchInput` in 7 (entity picker variants, table search), `AutosizeTextarea` in 5 (`SharedEditor`, `CommitMessageInput`, `LabelInput`, the editor primitive node), `InputAffix` in 5 (upload pills, column-visibility search). `PasswordInput` has a single call-site (`LabelInput`) and bare `Textarea` only backs `AutosizeTextarea`.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Inputs are width:100% — their width is the container's, not the component's. Each control
// gets a fixed-width box.
const CONTROL_BOX = "w-[220px] shrink-0"

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={CONTROL_BOX}>{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            <Row label="default">
                <ShadInput placeholder="text" />
            </Row>
            <Row label="filled">
                <ShadInput variant="filled" placeholder="text" />
            </Row>
            <Row label="ghost">
                <ShadInput variant="ghost" placeholder="text" />
            </Row>
            <Row label="size=sm">
                <ShadInput size="sm" placeholder="s" />
            </Row>
            <Row label="size=lg">
                <ShadInput size="lg" placeholder="l" />
            </Row>
            <Row label="disabled">
                <ShadInput disabled placeholder="d" />
            </Row>
            <Row label="aria-invalid">
                <ShadInput aria-invalid placeholder="e" />
            </Row>
            <Row label="InputAffix · prefix">
                <InputAffix
                    aria-label="Field"
                    prefix={<MagnifyingGlass size={14} />}
                    placeholder="search"
                />
            </Row>
            <Row label="InputAffix · allowClear">
                <InputAffix aria-label="Field" allowClear defaultValue="clear me" />
            </Row>
            {/* SearchInput is a prefixed, clearable input with no trailing search button. */}
            <Row label="SearchInput">
                <SearchInput placeholder="search" />
            </Row>
            <Row label="PasswordInput">
                <PasswordInput aria-label="Password" defaultValue="hunter2" />
            </Row>
            {/* Resizes vertically only; drag the corner to check it stays in its column. */}
            <Row label="textarea (resize-y)">
                <Textarea rows={2} placeholder="ta" />
            </Row>
            <Row label="AutosizeTextarea">
                <AutosizeTextarea autoSize={{minRows: 2, maxRows: 6}} placeholder="grows" />
            </Row>
        </div>
    ),
}

// Interaction states rendered statically via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-focus-within-all` / `pseudo-hover-all`, which forces that pseudo-class on
// the input inside.
const StateRow = ({
    label,
    pseudo,
    children,
}: {
    label: string
    pseudo: string
    children: React.ReactNode
}) => (
    <div className="grid grid-cols-[14rem_auto] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo} ${CONTROL_BOX}`}>{children}</div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            {/* focus-within (not focus): the glow is gated on :focus-within so it also fires on
                the affix wrapper when its inner <input> is focused. On a bare <input> the two
                are equivalent. Force with pseudo-focus-within-all, not pseudo-focus-all. */}
            <StateRow label="default · focus" pseudo="pseudo-focus-within-all">
                <ShadInput defaultValue="text" />
            </StateRow>
            <StateRow label="filled · focus" pseudo="pseudo-focus-within-all">
                <ShadInput variant="filled" defaultValue="text" />
            </StateRow>
            <StateRow label="error · focus" pseudo="pseudo-focus-within-all">
                <ShadInput aria-invalid defaultValue="text" />
            </StateRow>
            <StateRow
                label="affix · focus-within (inner input focused)"
                pseudo="pseudo-focus-within-all"
            >
                <InputAffix aria-label="Field" prefix={<MagnifyingGlass />} defaultValue="text" />
            </StateRow>
            <StateRow label="textarea · focus" pseudo="pseudo-focus-within-all">
                <Textarea rows={2} defaultValue="text" />
            </StateRow>
            <StateRow label="textarea · error" pseudo="">
                <Textarea aria-invalid rows={2} defaultValue="text" />
            </StateRow>
            <StateRow label="default · hover" pseudo="pseudo-hover-all">
                <ShadInput defaultValue="text" />
            </StateRow>
        </div>
    ),
}
