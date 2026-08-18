import {useState} from "react"

import {
    Tooltip as ShadTooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tooltip as AntTooltip} from "antd"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/Tooltip",
    component: TooltipContent,
    subcomponents: {"Tooltip (root)": ShadTooltip, TooltipTrigger, TooltipProvider},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Tooltip (Radix-based) that replaces antd `Tooltip`. Compose `Tooltip` > `TooltipTrigger` + `TooltipContent`. Prop tables for each part are below.\n\n**Used in:** 22 places — `CopyTooltip` plus nearly every presentational facade (`EnhancedButton`, `CollapseToggleButton`, `FieldHeader`, `MetadataHeader`, `FormattedDate`, `EditableText`, `FileAttachment`, `ExecutionMetricsDisplay`, `ConfigAccordionSection`, `Field`), the metric cell renderers, the editor token and markdown plugins, the LLM provider picker, and the drill-in toolbars.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">agenta</span>
            {s}
        </div>
    </div>
)

const TRIGGER =
    "inline-flex items-center rounded-control border border-solid border-colorBorder px-2 py-1 text-xs"

// Forced-OPEN state rendered INLINE (portal container) so antd and agenta tooltips sit side
// by side with NO hover. antd: `open` + `getPopupContainer`. @agenta/ui Radix: `open` on Root +
// `container` on TooltipContent.
function Panel({render}: {render: (c: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[120px] w-[220px]">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    render: () => (
        <div
            className="flex gap-24 p-4"
            data-open-compare
            data-vrt-expected="sub-pixel placement: floating-ui snaps Radix to the device grid (roundByDPR), rc-trigger does not — 199 absolute px, the smallest count in the overlay set"
        >
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntTooltip open getPopupContainer={() => c} title="Tooltip text">
                            <span className={TRIGGER}>Hover me</span>
                        </AntTooltip>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <TooltipProvider>
                            <ShadTooltip open>
                                <TooltipTrigger asChild>
                                    <span className={TRIGGER}>Hover me</span>
                                </TooltipTrigger>
                                <TooltipContent container={c}>Tooltip text</TooltipContent>
                            </ShadTooltip>
                        </TooltipProvider>
                    )}
                />
            </div>
        </div>
    ),
}

export const AntdVsAgenta: Story = {
    render: () => (
        <TooltipProvider>
            <div className="flex flex-col max-w-[900px]">
                <Row
                    label="short text"
                    a={
                        <AntTooltip title="Tooltip text">
                            <span className={TRIGGER}>Hover me</span>
                        </AntTooltip>
                    }
                    s={
                        <ShadTooltip>
                            <TooltipTrigger asChild>
                                <span className={TRIGGER}>Hover me</span>
                            </TooltipTrigger>
                            <TooltipContent>Tooltip text</TooltipContent>
                        </ShadTooltip>
                    }
                />
                <Row
                    label="long text (wraps)"
                    a={
                        <AntTooltip title="This is a much longer tooltip that wraps onto several lines at the max width.">
                            <span className={TRIGGER}>Hover me</span>
                        </AntTooltip>
                    }
                    s={
                        <ShadTooltip>
                            <TooltipTrigger asChild>
                                <span className={TRIGGER}>Hover me</span>
                            </TooltipTrigger>
                            <TooltipContent>
                                This is a much longer tooltip that wraps onto several lines at the
                                max width.
                            </TooltipContent>
                        </ShadTooltip>
                    }
                />
            </div>
        </TooltipProvider>
    ),
}
