import {VersionBadge} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// VersionBadge — a pure presentational span rendering a version in "vN" format. Verified: no
// revision of VersionBadge.tsx has ever imported antd (it is not a facade over antd Tag), so there
// is no pre-migration baseline to diff against. The antd cell carries the established
// "agenta only, no antd counterpart" caption, which makes the VRT drop the row instead of
// comparing a caption against a real control. Legitimately unmeasured.
const meta = {
    title: "@agenta/ui/Presentational/Tags/VersionBadge",
    component: VersionBadge,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'A pure presentational @agenta/ui span rendering a version in "vN" format across text/chip/bold variants. No antd counterpart.\n\n**Used in:** 11 places — deployment cards and the deploy-variant modals, the playground header and comparison navigation cards, the edit-evaluation drawer, the entity commit modal, the annotation queue evaluator selector, plus `RevisionLabel`, `EntityNameWithVersion` and `EntityIconLabel`.',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const AntdOnly = () => (
    <span className="text-[10px] italic text-colorTextSecondary">
        agenta only, no antd counterpart
    </span>
)

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="text" a={<AntdOnly />} s={<VersionBadge version={3} variant="text" />} />
            <Row label="chip" a={<AntdOnly />} s={<VersionBadge version={3} variant="chip" />} />
            <Row label="bold" a={<AntdOnly />} s={<VersionBadge version={12} variant="bold" />} />
            <Row
                label="small chip"
                a={<AntdOnly />}
                s={<VersionBadge version={3} variant="chip" size="small" />}
            />
            <Row
                label="string version"
                a={<AntdOnly />}
                s={<VersionBadge version="1.2.0" variant="chip" />}
            />
        </div>
    ),
}
