import {type RefObject, useEffect, useRef, useState} from "react"

import {ScrollToTopButton} from "@agenta/ui/components"
import {Button as ShadButton} from "@agenta/ui/ui"
import {ArrowUp} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button} from "antd"

// ScrollToTopButton — a sticky "scroll to top" affordance that appears once its scroll container is
// scrolled past 300px. It WAS an antd `Button type="default" shape="circle"` (migrated to the
// @agenta/ui Button in commit e29e3f8586), so the antd column reproduces that pre-migration body.
const meta = {
    title: "@agenta/ui/Presentational/Buttons/ScrollToTopButton",
    component: ScrollToTopButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'A sticky "scroll to top" affordance that appears once its scroll container passes 300px. Migrated from antd `Button type="default" shape="circle"` to the @agenta/ui `Button size="icon" variant="outline"`; shown beside the antd button it replaces.\n\n**Used in:** 4 places — the gateway catalog drawer, the tool catalog and tool execution drawers, and the trigger events drawer (all `@agenta/entity-ui`).',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

// Verbatim reproduction of the pre-migration antd body (commit e29e3f8586^): same sticky wrapper
// and shadow, antd `Button type="default" shape="circle"` instead of the @agenta/ui Button.
//
// The pair measures ~1.3% and that residual is antd's, not ours: both buttons are 28×28 with the
// same 1px border, but antd wraps the icon in a `display:block` `.ant-btn-icon` whose line box
// carries the font's descender, so the glyph lands 0.75px ABOVE centre (svg offset 5.25px vs the
// geometric 6px). The @agenta/ui button flex-centres the svg exactly. 0.75px on a thin-stroke
// 16px arrow inside a 56×56 device-pixel crop is ~40 pixels, hence the ratio — the migrated
// rendering is the correct one, so this is not "fixed" back toward the antd artifact.
const AntdScrollToTopButton = ({scrollRef}: {scrollRef: RefObject<HTMLDivElement | null>}) => {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        const onScroll = () => {
            setVisible(el.scrollTop > 300)
        }
        el.addEventListener("scroll", onScroll, {passive: true})
        return () => el.removeEventListener("scroll", onScroll)
    }, [scrollRef])

    if (!visible) return null

    return (
        <div className="sticky bottom-4 flex justify-end pointer-events-none">
            <Button
                type="default"
                shape="circle"
                aria-label="Scroll to top"
                icon={<ArrowUp size={16} />}
                className="pointer-events-auto shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
                onClick={() => scrollRef.current?.scrollTo({top: 0, behavior: "smooth"})}
            />
        </div>
    )
}

// The button only mounts once its container is past 300px, so force-scroll on mount — a
// programmatic `scrollTop` still fires `scroll`, which is what flips the component visible.
const ScrollBox = ({kind}: {kind: "antd" | "agenta"}) => {
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
            {kind === "antd" ? (
                <AntdScrollToTopButton scrollRef={scrollRef} />
            ) : (
                <ScrollToTopButton scrollRef={scrollRef} />
            )}
        </div>
    )
}

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
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

// Row 1 is opted out of the pixel gate ("not reproduced") for the icon's VERTICAL position only —
// the derivation is in the AntdScrollToTopButton comment above. Row 2 re-gates everything else:
// wrapping the icon in a block-level span means the svg is no longer a DIRECT child of
// `.ant-btn-icon`, so antd's `vertical-align: -0.125em` rule stops applying and antd centres the
// glyph at exactly our position. Both halves render the same wrapper, so size/radius/border/fill/
// glyph and the horizontal position stay measured. The sticky wrapper's `0 2px 8px` drop shadow is
// left off: antd's own `defaultShadow` rule outranks that utility class on the antd half only.
const WRAPPED_ICON = (
    <span className="flex">
        <ArrowUp size={16} />
    </span>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="visible (scrolled past 300px) — 0.75px icon lift not reproduced (antd is off-centre)"
                a={<ScrollBox kind="antd" />}
                s={<ScrollBox kind="agenta" />}
            />
            <Row
                label="chrome (icon wrapped, so antd centres it too)"
                a={
                    <Button
                        type="default"
                        shape="circle"
                        aria-label="Scroll to top"
                        icon={WRAPPED_ICON}
                    />
                }
                s={
                    <ShadButton
                        size="icon"
                        variant="outline"
                        aria-label="Scroll to top"
                        className="rounded-control-round"
                    >
                        {WRAPPED_ICON}
                    </ShadButton>
                }
            />
        </div>
    ),
}
