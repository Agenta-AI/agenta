import {ModelNameInput} from "@agenta/entity-ui/secretProvider"
import type {Meta, StoryObj} from "@storybook/nextjs"

/** `ModelNameInput` (secretProvider): a model-name input with a trailing delete button. */
const meta = {
    title: "@agenta/entity-ui/SecretProvider/ModelNameInput",
    component: ModelNameInput,
} satisfies Meta<typeof ModelNameInput>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[260px] shrink-0">{children}</div>
    </div>
)

export const Variants: Story = {
    args: {onDelete: noop},
    render: () => (
        <div className="flex flex-col max-w-[900px]">
            <Row label="placeholder">
                <ModelNameInput onDelete={noop} value="" onChange={noop} />
            </Row>
            <Row label="with value">
                <ModelNameInput onDelete={noop} value="gpt-4o-mini" onChange={noop} />
            </Row>
            <Row label="disabled">
                <ModelNameInput onDelete={noop} value="gpt-4o-mini" disabled onChange={noop} />
            </Row>
        </div>
    ),
}
