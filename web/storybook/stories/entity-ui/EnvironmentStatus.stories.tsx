import {EnvironmentStatus} from "@agenta/entity-ui/variant"
import type {Meta, StoryObj} from "@storybook/nextjs"

// EnvironmentStatus — the deployment dots next to a variant name.
// The component reads the environment molecule only as a FALLBACK when `deployedIn` is
// absent; with `deployedIn` passed it renders from props (no fixture needed).
const meta = {
    title: "@agenta/entity-ui/Variant/EnvironmentStatus",
    component: EnvironmentStatus,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Deployment environment dots (production/staging/development), each with a tooltip naming the environment.",
            },
        },
    },
} satisfies Meta<typeof EnvironmentStatus>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, envs}: {label: string; envs: {name: string}[]}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="inline-flex">
            <EnvironmentStatus variant={{deployedIn: envs}} />
        </div>
    </div>
)

export const Variants: Story = {
    args: {variant: {deployedIn: [{name: "production"}]}},
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="production" envs={[{name: "production"}]} />
            <Row
                label="all three environments"
                envs={[{name: "production"}, {name: "staging"}, {name: "development"}]}
            />
            <Row label="unknown env (transparent dot)" envs={[{name: "shadow"}]} />
        </div>
    ),
}
