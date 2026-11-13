import {useState} from "react"

import {
    Tooltip as ShadTooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Overlays/Tooltip",
    component: TooltipContent,
    subcomponents: {"Tooltip (root)": ShadTooltip, TooltipTrigger, TooltipProvider},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Tooltip (Radix-based). Compose `Tooltip` > `TooltipTrigger` + `TooltipContent`. Prop tables for each part are below.\n\n**Used in:** 22 places — `CopyTooltip` plus nearly every presentational facade (`EnhancedButton`, `CollapseToggleButton`, `FieldHeader`, `MetadataHeader`, `FormattedDate`, `EditableText`, `FileAttachment`, `ExecutionMetricsDisplay`, `ConfigAccordionSection`, `Field`), the metric cell renderers, the editor token and markdown plugins, the LLM provider picker, and the drill-in toolbars.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

const TRIGGER =
    "inline-flex items-center rounded-control border border-solid border-colorBorder px-2 py-1 text-xs"

// Forced-OPEN state rendered INLINE (portal container) so the tooltip shows with NO hover:
// `open` on Root + `container` on TooltipContent.
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
        <div className="p-4">
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
    ),
}

export const Variants: Story = {
    render: () => (
        <TooltipProvider>
            <div className="flex flex-col max-w-[560px]">
                <Row label="short text">
                    <ShadTooltip>
                        <TooltipTrigger asChild>
                            <span className={TRIGGER}>Hover me</span>
                        </TooltipTrigger>
                        <TooltipContent>Tooltip text</TooltipContent>
                    </ShadTooltip>
                </Row>
                <Row label="long text (wraps)">
                    <ShadTooltip>
                        <TooltipTrigger asChild>
                            <span className={TRIGGER}>Hover me</span>
                        </TooltipTrigger>
                        <TooltipContent>
                            This is a much longer tooltip that wraps onto several lines at the max
                            width.
                        </TooltipContent>
                    </ShadTooltip>
                </Row>
            </div>
        </TooltipProvider>
    ),
}
