import type {ReactNode} from "react"

import {
    ClickRunPlaceholder,
    RepetitionNavigation,
    ResultPlaceholder,
    RunningPlaceholder,
    TypingIndicator,
} from "@agenta/playground-ui/execution-row"
import {NodeNameTag} from "@agenta/playground-ui/shared"
import {Badge} from "@agenta/ui/ui"
import {LoadingOutlined} from "@ant-design/icons"
import {CaretLeft, CaretRight} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Spin as AntSpin,
    Tag as AntTag,
    Typography as AntTypography,
} from "antd"

/**
 * The wave-3 leaves — the small presentational pieces that carried most of the package's antd
 * `Tag` / `Spin` / `Button` usage. Grouped into one file because each is a handful of lines and
 * a story per component would be more scaffolding than subject.
 *
 * The antd halves are the pre-migration bodies, reconstructed from `git show main:<path>`.
 */
const meta = {
    title: "@agenta/playground-ui/Shared/Leaves",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Status tags, placeholders, the typing indicator and the repetition pager.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

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
        className="grid grid-cols-[11rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="w-[300px]">
                {a}
            </div>
        </div>
        <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="w-[300px]">
                {s}
            </div>
        </div>
    </div>
)

/* ── pre-migration bodies, from `git show main:…` ──────────────────────────── */

const AntdTypingIndicator = ({size = "default"}: {size?: "small" | "default"}) => (
    <div className="w-full px-3 py-2 rounded-md text-[13px] text-[var(--ag-c-667085BF)]">
        <AntSpin
            indicator={
                <LoadingOutlined
                    style={{fontSize: size === "small" ? 12 : 14, color: "rgba(102,112,133,0.75)"}}
                    spin
                />
            }
            size={size === "small" ? "small" : "default"}
        />
        <span className="ml-2 align-middle">Generating response...</span>
    </div>
)

const AntdRepetitionNavigation = ({current = 2, total = 5}: {current?: number; total?: number}) => (
    <div className="flex items-center gap-1">
        <AntButton
            icon={<CaretLeft size={12} />}
            size="small"
            type="text"
            disabled={current <= 1}
            className="!w-5 !h-5"
        />
        <AntTypography.Text type="secondary" className="text-[10px] text-nowrap">
            {current} / {total}
        </AntTypography.Text>
        <AntButton
            icon={<CaretRight size={12} />}
            size="small"
            type="text"
            disabled={current >= total}
            className="!w-5 !h-5"
        />
    </div>
)

/** Includes NodeNameTag's own wrapping `div` — without it the antd half would hug its content
 *  while the real component fills its row, and the pair would not be comparable. */
const AntdNodeNameTag = ({
    name,
    version,
    isDraft,
}: {
    name: string
    version?: number
    isDraft?: boolean
}) => (
    <div className="flex items-center gap-1">
        <AntTag
            variant="filled"
            className="!m-0 rounded-[6px] px-2 py-[1px] text-xs leading-[22px] bg-[var(--ag-c-0517290F)] text-[var(--ag-c-344054)] border border-solid border-transparent"
        >
            {name}
            {version != null && <span className="text-[var(--ag-c-667085)] ml-1">v{version}</span>}
        </AntTag>
        {isDraft && (
            <AntTag
                variant="filled"
                className="!m-0 rounded-[6px] px-1.5 py-[1px] text-[10px] leading-[22px] bg-[var(--ag-c-FFF7E6)] text-[var(--ag-c-D4760A)] border border-solid border-[var(--ag-c-FFE4B5)]"
            >
                draft
            </AntTag>
        )}
    </div>
)

const AntdVerdictTag = ({pass}: {pass: boolean}) => (
    <AntTag
        color={pass ? "success" : "error"}
        className="!m-0 text-xs rounded-md px-2 py-0 leading-5"
    >
        {pass ? "true" : "false"}
    </AntTag>
)

const AntdStatusTags = () => (
    <div className="flex items-center gap-2">
        <AntTag color="warning">Loading...</AntTag>
        <AntTag color="error">Error</AntTag>
        <AntTag color="success">Ready</AntTag>
    </div>
)

const AgentaStatusTags = () => (
    <div className="flex items-center gap-2">
        <Badge variant="warning">Loading...</Badge>
        <Badge variant="error">Error</Badge>
        <Badge variant="success">Ready</Badge>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="typing indicator"
                a={<AntdTypingIndicator />}
                s={<TypingIndicator />}
                expected="antd Spin's indicator was a spinning `anticon-loading` glyph (a single rotating 1em icon); Spinner renders antd v6's own 4-dot square holder. Different glyph by design — the Spinner primitive is what the programme standardised on (migrations/Spinner.md). Box, padding and label are identical."
            />
            <Row
                label="typing indicator (small)"
                a={<AntdTypingIndicator size="small" />}
                s={<TypingIndicator size="small" />}
                expected="as above, at the small size."
            />
            <Row
                label="repetition pager"
                a={<AntdRepetitionNavigation />}
                s={<RepetitionNavigation current={2} total={5} onPrev={noop} onNext={noop} />}
            />
            <Row
                label="node name tag"
                a={<AntdNodeNameTag name="classify" version={3} />}
                s={<NodeNameTag name="classify" version={3} />}
            />
            <Row
                label="node name tag (draft)"
                a={<AntdNodeNameTag name="classify" version={3} isDraft />}
                s={<NodeNameTag name="classify" version={3} isDraft />}
                expected="the draft chip moves from a hand-rolled amber Tag (bg #FFF7E6 / text #D4760A / border #FFE4B5, all raw hex frozen in light) to Badge variant='draft', which is the same family sourced from the palette's draftTag tokens — so only this side responds to the theme."
            />
            <Row
                label="verdict tag (pass)"
                a={<AntdVerdictTag pass />}
                s={
                    <Badge variant="success" className="m-0 text-xs rounded-md px-2 py-0 leading-5">
                        true
                    </Badge>
                }
            />
            <Row
                label="verdict tag (fail)"
                a={<AntdVerdictTag pass={false} />}
                s={
                    <Badge variant="error" className="m-0 text-xs rounded-md px-2 py-0 leading-5">
                        false
                    </Badge>
                }
            />
            <Row label="entity status tags" a={<AntdStatusTags />} s={<AgentaStatusTags />} />
        </div>
    ),
}

/** Placeholders have no antd half — they were always plain markup. */
export const Placeholders: Story = {
    render: () => (
        <div className="flex max-w-[600px] flex-col gap-3">
            <ResultPlaceholder message="No result yet" />
            <RunningPlaceholder />
            <ClickRunPlaceholder />
        </div>
    ),
}
