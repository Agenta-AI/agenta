import type {ReactNode} from "react"

import {ControlsBar, EmptyState, ToolCallView} from "@agenta/playground-ui"
import {Button, EmptyState as EmptyStateBase} from "@agenta/ui/ui"
import {Lightning, Play} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Empty as AntEmpty,
    Space as AntSpace,
    Typography as AntTypography,
} from "antd"

/**
 * The package's three prop-only components — no atoms, no context, no fixtures.
 *
 * `ControlsBar` and `ToolCallView` were already antd-free; they are here purely for inventory.
 * `EmptyState` is a wave-3 migration (antd `Empty`/`Space`/`Typography`/`Button`), so it gets a
 * parity row against the pre-migration body.
 */
const meta = {
    title: "@agenta/playground-ui/Presentational",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component: "Run controls, the tool-call viewer, and the empty playground state.",
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
        className="grid grid-cols-[9rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="w-[380px]">
                {a}
            </div>
        </div>
        <div className="flex items-start gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="w-[380px]">
                {s}
            </div>
        </div>
    </div>
)

/** Pre-migration EmptyState body, from `git show main:…/components/EmptyState.tsx`. */
const AntdEmptyState = () => (
    <AntEmpty
        image={
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                <Play size={32} weight="light" className="text-gray-400" />
            </div>
        }
        description={
            <AntSpace orientation="vertical" size="small">
                <AntTypography.Title level={4} style={{marginBottom: 0}}>
                    Start your playground
                </AntTypography.Title>
                <AntTypography.Text type="secondary" className="block max-w-md">
                    Add an app revision or evaluator to begin. You&apos;ll then be able to connect
                    test data and run experiments.
                </AntTypography.Text>
            </AntSpace>
        }
    >
        <AntButton type="primary" icon={<Lightning size={14} />}>
            Add App Revision or Evaluator
        </AntButton>
    </AntEmpty>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1200px] flex-col">
            <Row
                label="empty playground"
                a={<AntdEmptyState />}
                s={<EmptyState onAddRunnable={noop} />}
                expected="COLOUR ONLY — the antd original used raw Tailwind greys that never responded to the theme (bg-gray-100 on the icon disc, text-gray-400 on the glyph); the migrated body uses colorFillQuaternary / colorTextDescription. antd Title level={4} maps to text-base/font-semibold on colorTextHeading, and Space direction=vertical size=small to flex-col gap-2 (both 8px). Only the migrated side is theme-aware."
            />
        </div>
    ),
}

/** No antd half — these two were never on antd. */
export const RunControls: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            <ControlsBar onRun={noop} onCancel={noop} onAddMessage={noop} />
            <ControlsBar isRunning onRun={noop} onCancel={noop} onAddMessage={noop} />
        </div>
    ),
}

/**
 * `resultData` is parsed by `createToolCallPayloads`, which looks for `tool_calls` under the
 * value (or under its `.data`). A bare `{name, arguments}` object yields zero payloads and the
 * component returns `null` — which is why this story renders the real assistant-message shape.
 */
export const ToolCall: Story = {
    render: () => (
        <div className="max-w-[640px]">
            <ToolCallView
                resultData={{
                    tool_calls: [
                        {
                            id: "call_8fd2",
                            type: "function",
                            function: {
                                name: "search_docs",
                                arguments: JSON.stringify({query: "refund policy", top_k: 3}),
                            },
                        },
                    ],
                }}
            />
        </div>
    ),
}

/** The primitive on its own, for the two image presets the package does not use directly. */
export const EmptyStatePresets: Story = {
    render: () => (
        <div className="flex flex-col gap-6">
            <EmptyStateBase image="default" description="No data" />
            <EmptyStateBase image="simple" description="Nothing here yet">
                <Button variant="outline">Add one</Button>
            </EmptyStateBase>
        </div>
    ),
}
