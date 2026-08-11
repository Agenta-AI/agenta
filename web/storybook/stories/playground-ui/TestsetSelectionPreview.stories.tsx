import type {ReactNode} from "react"

import {TestsetSelectionPreview} from "@agenta/playground-ui/testset-selection"
import {spacingClasses} from "@agenta/ui/styles"
import {Divider} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Divider as AntDivider, Input as AntInput} from "antd"

// TestsetSelectionPreview — the modal's right panel (search + table slot).
//
// This story carries the programme's ONE documented deviation: antd `Input.Search` renders a
// trailing search button, and `SearchInput` deliberately does not reproduce it
// (antd-inventory/migrations/Input.md). The `search` row below is expected to differ and says
// so with a measurement, rather than being quietly excluded.
//
// The `vertical divider` row is not this component — it is the one antd swap inside
// LoadModeContent (367 lines, 6 atom hooks), lifted out so the geometry that actually changed
// is gated without fixturing the whole container. antd 6 renamed the axis prop to
// `orientation`; the @agenta/ui primitive kept antd 5's `type`, so the call site reads
// differently on each side while meaning the same thing.
const meta = {
    title: "@agenta/playground-ui/TestsetSelection/TestsetSelectionPreview",
    component: TestsetSelectionPreview,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Search field over the testcase table. Uses SearchInput, which drops antd's trailing search button.",
            },
        },
    },
} satisfies Meta<typeof TestsetSelectionPreview>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/**
 * Pre-migration body, verbatim from `git show main:…/TestsetSelectionPreview.tsx`.
 *
 * The compared cells deliberately render the panel with NO table slot. A 1% VRT ratio is only
 * meaningful relative to its crop, and with a table box in the frame the search field is a
 * small enough fraction that a real control-level difference measures under threshold — the
 * gate would pass while proving nothing about the thing that actually changed.
 */
const AntdPreview = ({
    searchTerm = "",
    showSearch = true,
    slot = null,
}: {
    searchTerm?: string
    showSearch?: boolean
    slot?: ReactNode
}) => (
    <div
        className={`flex flex-col flex-1 overflow-hidden ${spacingClasses.panel}`}
        style={{minWidth: 0, minHeight: 0}}
    >
        {showSearch && (
            <AntInput.Search
                placeholder="Search testcases..."
                value={searchTerm}
                onChange={noop}
                className="mb-3 flex-shrink-0"
            />
        )}
        {slot}
    </div>
)

const TableSlot = () => (
    <div className="rounded border border-dashed border-colorBorderSecondary p-4 text-xs text-colorTextDescription">
        table slot
    </div>
)

/**
 * Both cells are pinned to the same fixed width. Without it the two sides size to their own
 * content — antd's `ant-space-compact` hugs, our `input-affix` is `w-full` — and the harness
 * ends up comparing an 83px box against a 210px one, which reads as a sub-1% pass while
 * proving nothing. In the real modal the panel is width-constrained by its parent.
 */
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
        className="grid grid-cols-[9rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="w-[320px]">
                {a}
            </div>
        </div>
        <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="w-[320px]">
                {s}
            </div>
        </div>
    </div>
)

/** The vertical divider as LoadModeContent lays it out: a flex row, self-stretched. */
const DividerRow = ({antd}: {antd: boolean}) => (
    <div className="flex h-24 items-stretch">
        <div className="flex-1 rounded bg-colorFillQuaternary" />
        {antd ? (
            <AntDivider orientation="vertical" className="my-0 mx-8 h-auto self-stretch" />
        ) : (
            <Divider type="vertical" className="my-0 mx-8 h-auto self-stretch" />
        )}
        <div className="flex-1 rounded bg-colorFillQuaternary" />
    </div>
)

export const AntdVsAgenta: Story = {
    args: {searchTerm: "", onSearchChange: noop, children: <TableSlot />},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="search (empty)"
                a={<AntdPreview />}
                s={
                    <TestsetSelectionPreview searchTerm="" onSearchChange={noop}>
                        {null}
                    </TestsetSelectionPreview>
                }
                expected="KNOWN DEVIATION (migrations/Input.md). Measured in-browser at a pinned 320px cell: antd splits the 288px row into a 261px input + a 28x30px .ant-input-search-btn; SearchInput spends the whole 288px on one affix wrapper and puts a 14px MagnifyingGlass prefix inside instead. FIELD HEIGHT IS EXACT on both sides (30px), so this is the dropped trailing button and nothing else — radius/border/height come from the shared Input primitive and are gated by input--antd-vs-agenta."
            />
            <Row
                label="search (typed)"
                a={<AntdPreview searchTerm="claim" />}
                s={
                    <TestsetSelectionPreview searchTerm="claim" onSearchChange={noop}>
                        {null}
                    </TestsetSelectionPreview>
                }
                expected="as the empty row (28x30px search button dropped), plus SearchInput's allowClear adds a trailing clear button once the field is non-empty — the antd call site never passed allowClear, so it has none. Net at 320px: antd = input + 28px search button; ours = prefix + input + clear. The clear button is an addition, not a regression; it is what SearchInput bakes in."
            />
            {/* No search bar: the panel is pure passthrough, so this row must be pixel-identical. */}
            <Row
                label="search hidden"
                a={<AntdPreview showSearch={false} slot={<TableSlot />} />}
                s={
                    <TestsetSelectionPreview searchTerm="" onSearchChange={noop} showSearch={false}>
                        <TableSlot />
                    </TestsetSelectionPreview>
                }
            />
            <Row label="vertical divider" a={<DividerRow antd />} s={<DividerRow antd={false} />} />
        </div>
    ),
}
