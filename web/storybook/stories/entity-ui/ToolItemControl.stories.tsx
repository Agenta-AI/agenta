import {useRef, type ReactNode} from "react"

import {ToolItemControl} from "@agenta/entity-ui/drill-in"
import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {CopySimple, GraphIcon, MinusCircle} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Tooltip as AntTooltip, Typography as AntTypography} from "antd"

// ToolItemControl — one tools[] entry: a header (function / builtin / gateway / workflow
// reference) over the JSON editor. Storybook renders it without a `SharedEditor` injection,
// so both halves take the documented textarea fallback branch — the header, which is the
// migrated surface, is identical in both.
//
// The antd half replays the pre-migration `ToolHeader` verbatim from
// feat/storybook-data-seam (antd `Typography.Text`, `Tooltip title`, and
// `Button icon type="text" size="small"`), inside the same fallback card.
//
// antd swaps: `Typography.Text` → span + semantic token classes (`strong` →
// `font-semibold`, antd's `fontWeightStrong` is 600); `Tooltip title` → Radix
// `Tooltip`/`TooltipTrigger asChild`/`TooltipContent` under one `TooltipProvider`;
// icon-only `Button type="text" size="small"` → `variant="ghost" size="icon-sm"` with the
// icon as a child and an `aria-label` (the tooltip is no longer the accessible name).
const meta = {
    title: "@agenta/entity-ui/DrillIn/ToolItemControl",
    component: ToolItemControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Schema-driven control for one tool definition. Header variants: custom function, provider builtin, gateway (integration/action/connection) and workflow reference.",
            },
        },
    },
} satisfies Meta<typeof ToolItemControl>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const FUNCTION_TOOL = {
    type: "function",
    function: {
        name: "get_weather",
        description: "Get current weather",
        parameters: {
            type: "object",
            properties: {location: {type: "string", description: "City name"}},
            required: ["location"],
            additionalProperties: false,
        },
    },
}

const BUILTIN_TOOL = {type: "web_search_preview"}

const REFERENCE_TOOL = {
    type: "reference",
    ref_by: "variant",
    slug: "summarizer",
    name: "summarize_thread",
    description: "Summarize a support thread into three bullets",
    input_schema: {type: "object", properties: {thread: {type: "string"}}},
}

// ---------------------------------------------------------------------------
// Pre-migration header + fallback card, verbatim (antd baseline)
// ---------------------------------------------------------------------------

const json = (value: unknown) => JSON.stringify(value, null, 2)

const AntdCard = ({children, value}: {children: ReactNode; value?: unknown}) => (
    <div className="group/tool flex flex-col gap-2 border rounded-lg p-3">
        {children}
        {value === undefined ? null : (
            <textarea
                className="font-mono text-xs p-2 border rounded min-h-[120px] resize-y w-full"
                aria-label="Tool JSON"
                defaultValue={json(value)}
                readOnly
            />
        )}
    </div>
)

/** The migrated card passes its (never-attached, in this branch) containerRef to the toggle,
 *  which auto-disables when the ref resolves to nothing — mirror that here or the chevron
 *  renders enabled on the antd half only. */
const AntdActions = () => {
    const contentRef = useRef<HTMLElement>(null)
    return (
        <div className="flex items-center gap-1 invisible group-hover/tool:visible shrink-0">
            <AntTooltip title="Duplicate">
                <AntButton icon={<CopySimple size={14} />} type="text" size="small" />
            </AntTooltip>
            <AntTooltip title="Remove">
                <AntButton icon={<MinusCircle size={14} />} type="text" size="small" />
            </AntTooltip>
            <CollapseToggleButton collapsed={false} onToggle={noop} contentRef={contentRef} />
        </div>
    )
}

const AntdFunctionHeader = () => (
    <div className="w-full flex items-start justify-between py-1">
        <div className="grow min-w-0">
            <div className="flex flex-col gap-0.5">
                <AntTypography.Text strong className="text-sm truncate">
                    get_weather
                </AntTypography.Text>
                <AntTypography.Text type="secondary" className="text-xs">
                    Get current weather
                </AntTypography.Text>
            </div>
        </div>
        <AntdActions />
    </div>
)

// Hoisted: resolving it inside the body makes a fresh component identity every render.
const OpenAIIcon = getProviderIcon("openai")

const AntdBuiltinHeader = () => {
    return (
        <div className="w-full flex items-start justify-between py-1">
            <div className="grow min-w-0">
                <div className="flex items-center gap-1">
                    <div className="flex items-center">
                        <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-[var(--ag-c-F8FAFC)]">
                            {OpenAIIcon ? <OpenAIIcon className="w-4 h-4" /> : null}
                        </span>
                        <AntTypography.Text>OpenAI</AntTypography.Text>
                    </div>
                    <AntTypography.Text>/</AntTypography.Text>
                    <AntTypography.Text type="secondary">web_search</AntTypography.Text>
                </div>
            </div>
            <AntdActions />
        </div>
    )
}

const AntdReferenceHeader = () => (
    <div className="w-full flex items-start justify-between py-1">
        <div className="grow min-w-0">
            <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-[var(--ag-c-F8FAFC)]">
                        <GraphIcon size={14} />
                    </span>
                    <AntTypography.Text strong className="text-sm truncate">
                        summarize_thread
                    </AntTypography.Text>
                    <AntTypography.Text type="secondary" className="text-xs truncate">
                        / summarizer
                    </AntTypography.Text>
                </div>
                <AntTypography.Text type="secondary" className="text-xs">
                    Summarize a support thread into three bullets
                </AntTypography.Text>
            </div>
        </div>
        <AntdActions />
    </div>
)

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

/** The three header shapes, with the hover-only action rail forced visible on both halves. */
export const AntdVsAgenta: Story = {
    args: {value: FUNCTION_TOOL},
    render: () => (
        // `[&_.invisible]:!visible` reveals the `group-hover/tool` action rail on BOTH halves
        // (identical classes), so the migrated icon buttons are actually pixel-diffed.
        <div className="flex max-w-[1100px] flex-col [&_.invisible]:!visible">
            <Row
                label="function tool"
                a={
                    <AntdCard value={FUNCTION_TOOL}>
                        <AntdFunctionHeader />
                    </AntdCard>
                }
                s={
                    <ToolItemControl
                        value={FUNCTION_TOOL}
                        onDelete={noop}
                        onDuplicate={noop}
                        onChange={noop}
                    />
                }
            />
            <Row
                label="builtin tool"
                a={
                    <AntdCard value={BUILTIN_TOOL}>
                        <AntdBuiltinHeader />
                    </AntdCard>
                }
                s={
                    <ToolItemControl
                        value={BUILTIN_TOOL}
                        onDelete={noop}
                        onDuplicate={noop}
                        onChange={noop}
                    />
                }
            />
            <Row
                label="workflow reference"
                a={
                    // Reference tools start collapsed (minimized=true) → header only, no editor.
                    <AntdCard>
                        <AntdReferenceHeader />
                    </AntdCard>
                }
                s={
                    <ToolItemControl
                        value={REFERENCE_TOOL}
                        onDelete={noop}
                        onDuplicate={noop}
                        onChange={noop}
                    />
                }
            />
        </div>
    ),
}

/** Read-only: no duplicate/remove controls, the editor is not writable. */
export const ReadOnly: Story = {
    args: {value: FUNCTION_TOOL, disabled: true},
    render: () => (
        <div className="max-w-[520px]">
            <ToolItemControl value={FUNCTION_TOOL} disabled onDelete={noop} onDuplicate={noop} />
        </div>
    ),
}
