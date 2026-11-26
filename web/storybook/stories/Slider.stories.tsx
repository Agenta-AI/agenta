import {Slider} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Slider",
    component: Slider,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A horizontal Slider on Radix (`@radix-ui/react-slider`) + cva: a 4px rail, a primary-tint filled track, and a 10px white handle with a 2px ring that recolours on hover/focus. shadcn-native API (`value`/`onValueChange` as number arrays).\n\n**Used in:** nowhere — zero importers. `SliderInput`, its only consumer, was deleted as dead code (it had no call-sites at HEAD either). Kept as a primitive for the next slider that is needed.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-40">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <Row label="default (value 30)">
                <Slider defaultValue={[30]} />
            </Row>
            <Row label="min/max/step (0–2, step 0.1, value 0.7)">
                <Slider min={0} max={2} step={0.1} defaultValue={[0.7]} />
            </Row>
            <Row label="disabled">
                <Slider defaultValue={[40]} disabled />
            </Row>
            <Row label="full range (value 100)">
                <Slider defaultValue={[100]} />
            </Row>
        </div>
    ),
}
