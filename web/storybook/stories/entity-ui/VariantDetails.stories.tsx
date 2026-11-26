import {VariantDetails} from "@agenta/entity-ui/variant"
import type {Meta, StoryObj} from "@storybook/nextjs"

// VariantDetails — the name + vN + draft/latest cluster inside VariantDetailsWithStatus.
const meta = {
    title: "@agenta/entity-ui/Variant/VariantDetails",
    component: VariantDetails,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Presentational variant name/revision cluster: name, revision tag or text, and a draft or latest badge. The draft badge opens a discard dropdown.",
            },
        },
    },
} satisfies Meta<typeof VariantDetails>

export default meta
type Story = StoryObj<typeof meta>

interface DetailsArgs {
    variantName?: string
    revision?: number | string | null
    showRevisionAsTag?: boolean
    hasChanges?: boolean
    showLatestTag?: boolean
    isLatest?: boolean
    onDiscardDraft?: () => void
    hideDiscard?: boolean
}

const noop = () => undefined

const Row = ({label, args}: {label: string; args: DetailsArgs}) => (
    <div className="grid grid-cols-[11rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="inline-flex">
            <VariantDetails {...args} />
        </div>
    </div>
)

export const Variants: Story = {
    args: {variantName: "My Agent", revision: 3},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="name + revision tag" args={{variantName: "My Agent", revision: 3}} />
            <Row
                label="revision as text"
                args={{variantName: "My Agent", revision: 3, showRevisionAsTag: false}}
            />
            <Row
                label="draft (discard dropdown, closed)"
                args={{
                    variantName: "My Agent",
                    revision: 3,
                    hasChanges: true,
                    onDiscardDraft: noop,
                }}
            />
            <Row
                label="draft · hideDiscard"
                args={{
                    variantName: "My Agent",
                    revision: 3,
                    hasChanges: true,
                    hideDiscard: true,
                }}
            />
            <Row
                label="latest → Last modified"
                args={{variantName: "My Agent", revision: 12, isLatest: true}}
            />
            <Row label="no name (hidden)" args={{revision: 7}} />
        </div>
    ),
}
