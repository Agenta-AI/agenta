import {useRef, useState} from "react"

import {ScrollSentinel} from "@agenta/ui/components"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/ScrollSentinel",
    component: ScrollSentinel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "An invisible IntersectionObserver marker that calls onVisible when scrolled into view (infinite-scroll prefetch). A pure @agenta/ui behavior primitive.\n\n**Used in:** 5 places — the shared catalog chooser and gateway catalog drawer, the tool catalog and tool execution drawers, and the trigger events drawer (all `@agenta/entity-ui`).",
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

export const Variants: Story = {
    render: () => (
        <div className="grid grid-cols-[12rem_1fr] items-start gap-4">
            <div className="text-xs text-colorTextSecondary">infinite scroll list</div>
            <Demo />
        </div>
    ),
}
