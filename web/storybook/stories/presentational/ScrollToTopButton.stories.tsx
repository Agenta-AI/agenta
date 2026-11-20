import {useEffect, useRef} from "react"

import {ScrollToTopButton} from "@agenta/ui/components"
import {Button as ShadButton} from "@agenta/ui/ui"
import {ArrowUp} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Buttons/ScrollToTopButton",
    component: ScrollToTopButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'A sticky "scroll to top" affordance that appears once its scroll container passes 300px. Built on the @agenta/ui `Button size="icon" variant="outline"`.\n\n**Used in:** 4 places — the gateway catalog drawer, the tool catalog and tool execution drawers, and the trigger events drawer (all `@agenta/entity-ui`).',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

// The button only mounts once its container is past 300px, so force-scroll on mount — a
// programmatic `scrollTop` still fires `scroll`, which is what flips the component visible.
const ScrollBox = () => {
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = 400
    }, [])

    return (
        <div
            ref={scrollRef}
            className="relative h-[220px] w-[280px] overflow-auto rounded-lg border border-solid border-colorBorderSecondary p-3"
        >
            {Array.from({length: 40}).map((_, i) => (
                <div
                    key={i}
                    className="border-b border-colorBorderSecondary py-2 text-xs text-colorText"
                >
                    Row {i + 1}
                </div>
            ))}
            <ScrollToTopButton scrollRef={scrollRef} />
        </div>
    )
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row label="visible (scrolled past 300px)">
                <ScrollBox />
            </Row>
            <Row label="chrome (button only)">
                <ShadButton
                    size="icon"
                    variant="outline"
                    aria-label="Scroll to top"
                    className="rounded-control-round"
                >
                    <ArrowUp size={16} />
                </ShadButton>
            </Row>
        </div>
    ),
}
