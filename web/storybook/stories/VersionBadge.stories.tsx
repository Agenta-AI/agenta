import {VersionBadge} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Tags/VersionBadge",
    component: VersionBadge,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'A pure presentational @agenta/ui span rendering a version in "vN" format across text/chip/bold variants.\n\n**Used in:** 11 places — deployment cards and the deploy-variant modals, the playground header and comparison navigation cards, the edit-evaluation drawer, the entity commit modal, the annotation queue evaluator selector, plus `RevisionLabel`, `EntityNameWithVersion` and `EntityIconLabel`.',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <Row label="text">
                <VersionBadge version={3} variant="text" />
            </Row>
            <Row label="chip">
                <VersionBadge version={3} variant="chip" />
            </Row>
            <Row label="bold">
                <VersionBadge version={12} variant="bold" />
            </Row>
            <Row label="small chip">
                <VersionBadge version={3} variant="chip" size="small" />
            </Row>
            <Row label="string version">
                <VersionBadge version="1.2.0" variant="chip" />
            </Row>
        </div>
    ),
}
