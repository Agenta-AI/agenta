import {useRef, useState} from "react"

import {ScrollSentinel} from "@agenta/ui/components"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ScrollSentinel — an invisible IntersectionObserver marker that calls `onVisible` when scrolled
// into view (infinite-scroll prefetch). It has no standalone visual, so it is demonstrated inside a
// live scroll list. No antd counterpart.
const meta = {
    title: "@agenta/ui/Presentational/Layout/ScrollSentinel",
    component: ScrollSentinel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "An invisible IntersectionObserver marker that calls onVisible when scrolled into view (infinite-scroll prefetch). A pure @agenta/ui behavior primitive with no antd counterpart.\n\n**Used in:** 5 places — the shared catalog chooser and gateway catalog drawer, the tool catalog and tool execution drawers, and the trigger events drawer (all `@agenta/entity-ui`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const PAGE = 10
const MAX = 40

const Demo = () => {
    const rootRef = useRef<HTMLDivElement>(null)
    const [count, setCount] = useState(PAGE)
    const hasMore = count < MAX
    return (
        <div
            ref={rootRef}
            className="h-[280px] w-[360px] overflow-auto rounded-lg border border-solid border-colorBorderSecondary p-3"
        >
            {Array.from({length: count}).map((_, i) => (
                <div
                    key={i}
                    className="border-b border-colorBorderSecondary py-2 text-xs text-colorText"
                >
                    Item {i + 1}
                </div>
            ))}
            {hasMore ? (
                <div className="py-2 text-center text-[10px] text-colorTextSecondary">
                    loading more…
                </div>
            ) : (
                <div className="py-2 text-center text-[10px] text-colorTextSecondary">
                    end of list
                </div>
            )}
            <ScrollSentinel
                hasMore={hasMore}
                isFetching={false}
                onVisible={() => setCount((c) => Math.min(MAX, c + PAGE))}
                root={rootRef.current}
                rootMargin="100px"
            />
        </div>
    )
}

export const AgentaOnly: Story = {
    render: () => (
        <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4">
            <div className="text-xs text-colorTextSecondary">infinite scroll list</div>
            <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
                <span className="text-[10px] italic text-colorTextSecondary">
                    no single antd counterpart (composite of @agenta/ui primitives / layout)
                </span>
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-colorTextSecondary">agenta</span>
                <Demo />
            </div>
        </div>
    ),
}
