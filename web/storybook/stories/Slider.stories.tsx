import {Slider} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Slider as AntSlider} from "antd"

// Slider — the antd horizontal Slider re-skinned on Radix (@radix-ui/react-slider) + cva. Same
// 4px rail / 10px white handle with a 2px primary-tint ring, driven by the shared token bridge so
// it flips light/dark automatically. Replaces the antd Slider in SliderInput.tsx.
const meta = {
    title: "@agenta/ui/Primitives/Forms/Slider",
    component: Slider,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "antd's horizontal Slider re-skinned on Radix (`@radix-ui/react-slider`) + cva. Reproduces antd's 4px rail (colorFillTertiary), colorPrimaryBorder filled track, and 10px white handle with a 2px box-shadow ring that recolours to colorPrimary on hover/focus. shadcn-native API (`value`/`onValueChange` as number arrays).\n\n**Used in:** nowhere — zero importers. `SliderInput`, its only consumer, was deleted as dead code (it had no call-sites at HEAD either). Kept as a parity-tested primitive for the next slider that is needed.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-40">{a}</div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-40">{s}</div>
        </div>
    </div>
)

// `.ant-slider` carries `margin: marginPart marginFull` = 9px 5px here (controlHeight 28,
// Slider controlSize 10), inseting the rail 5px each side; our Radix root spans the full box.
const NO_MARGIN = "!m-0"

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="default (value 30)"
                a={<AntSlider defaultValue={30} className={NO_MARGIN} />}
                s={<Slider defaultValue={[30]} />}
            />
            <Row
                label="min/max/step (0–2, step 0.1, value 0.7)"
                a={
                    <AntSlider
                        min={0}
                        max={2}
                        step={0.1}
                        defaultValue={0.7}
                        className={NO_MARGIN}
                    />
                }
                s={<Slider min={0} max={2} step={0.1} defaultValue={[0.7]} />}
            />
            <Row
                label="disabled"
                a={<AntSlider defaultValue={40} disabled className={NO_MARGIN} />}
                s={<Slider defaultValue={[40]} disabled />}
            />
            <Row
                label="full range (value 100)"
                a={<AntSlider defaultValue={100} className={NO_MARGIN} />}
                s={<Slider defaultValue={[100]} />}
            />
        </div>
    ),
}
