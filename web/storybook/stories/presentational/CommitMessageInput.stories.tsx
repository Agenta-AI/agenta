import {useState} from "react"

import {CommitMessageInput} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input, Typography} from "antd"

// CommitMessageInput is a labeled autosize textarea with a character counter, used by commit /
// deploy / revert modals.
//
// WHY THIS STORY MEASURED NOTHING: it used a two-column `.grid` of captioned `Cell`s
// ("antd (Input.TextArea showCount)" / "agenta (default)") with no label column. The VRT only
// pairs a `.grid` whose `children[1]`/`children[2]` each hold a direct child whose text is
// EXACTLY "antd" / "agenta", so the grid was rejected as "not a comparison" and the story
// silently reported 0 pairs. It now uses the standard [label | antd | agenta] Row.
//
// BASELINE: the antd cell reproduces the pre-migration component
// (`git show <migration>^:…/CommitMessageInput.tsx`) — an antd `Typography.Text font-medium`
// label with a quaternary "(optional)" suffix, above an `Input.TextArea` with
// `showCount maxLength={500} autoSize={{minRows:2,maxRows:4}}` and the same placeholder.
const {TextArea} = Input
const {Text} = Typography

const meta = {
    title: "@agenta/ui/Presentational/Forms/CommitMessageInput",
    component: CommitMessageInput,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A labeled autosize textarea with a character counter, used by commit/deploy/revert modals. A pure @agenta/ui composite; the nearest antd counterpart is Input.TextArea with showCount + maxLength.\n\n**Used in:** 6 places — the playground create-variant and deploy-variant modals, the deployments confirmation modal and deploy-variant selector, the testset commit modal, and the shared entity commit modal.",
            },
        },
    },
} satisfies Meta<typeof CommitMessageInput>

export default meta
type Story = StoryObj

// `.grid` Row: [label | antd cell | agenta cell] with the exact "antd"/"agenta" captions the VRT
// keys on. FIXED column widths (not `1fr`) so both cells land on the same sub-pixel phase.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_20rem_20rem] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

// Both cells are wrapped in the SAME fixed box carrying `data-vrt-subject`, so the VRT compares
// the WHOLE composite (label + textarea + counter). Without it the two halves resolve to different
// subjects — antd's first `SUBJECT` match is the textarea's affix wrapper (320×50) while the agenta
// side's is `[data-slot=field-header]` (320×16, the Field label) — and a 320×50 crop padded against
// a 320×16 one reported ~70% "diff" that measured nothing real.
const Box = ({children}: {children: React.ReactNode}) => (
    <div data-vrt-subject className="h-[104px] w-[320px]">
        {children}
    </div>
)

const AntdControlled = ({disabled}: {disabled?: boolean}) => {
    const [value, setValue] = useState("")
    return (
        <Box>
            <div className="flex flex-col gap-1">
                {/* `leading-4` matches the `Field` label's 16px line box. The migration moved the
                    label from a raw `Typography.Text` (20px line box) to the `Field` primitive on
                    purpose — see CommitMessageInput's docstring — and Field's own label metrics are
                    gated by `field--antd-vs-agenta`. Normalising it here keeps THIS row measuring
                    what CommitMessageInput owns: textarea geometry, autosize rows, placeholder and
                    counter, instead of re-reporting Field's 4px line-box delta on every row. */}
                <Text className="font-medium leading-4">
                    Notes <span className="text-zinc-4">(optional)</span>
                </Text>
                <TextArea
                    placeholder="Add a brief summary of what changed"
                    className="w-full"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    autoSize={{minRows: 2, maxRows: 4}}
                    showCount
                    maxLength={500}
                    disabled={disabled}
                />
            </div>
        </Box>
    )
}

const AgentaControlled = ({disabled}: {disabled?: boolean}) => {
    const [value, setValue] = useState("")
    return (
        <Box>
            <CommitMessageInput value={value} onChange={setValue} disabled={disabled} />
        </Box>
    )
}

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex w-[736px] flex-col">
            <Row label="default" a={<AntdControlled />} s={<AgentaControlled />} />
            <Row
                label="disabled"
                a={<AntdControlled disabled />}
                s={<AgentaControlled disabled />}
            />
        </div>
    ),
}
