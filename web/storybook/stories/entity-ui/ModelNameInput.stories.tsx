import {ModelNameInput} from "@agenta/entity-ui/secretProvider"
import {Trash} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Input as AntInput} from "antd"

/**
 * Parity story for the antd→@agenta/ui migration of `ModelNameInput` (secretProvider).
 * The antd half reproduces the PRE-migration body exactly (antd `Input` + antd
 * `Button type="link"` with a Trash icon, absolutely positioned inside the field) —
 * verified against
 * `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/secretProvider/ModelNameInput.tsx`.
 */
const meta = {
    title: "@agenta/entity-ui/SecretProvider/ModelNameInput",
    component: ModelNameInput,
} satisfies Meta<typeof ModelNameInput>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** The pre-migration antd body. */
const AntdModelNameInput = ({value, disabled}: {value?: string; disabled?: boolean}) => (
    <div className="w-full relative">
        <AntInput
            placeholder="Enter model name"
            className="w-full"
            disabled={disabled}
            value={value}
            onChange={noop}
        />
        <AntButton
            icon={<Trash size={14} />}
            type="link"
            className="absolute top-[1px] right-1"
            onClick={noop}
            disabled={disabled}
        />
    </div>
)

// Fixed-width boxes so `width` measures the component, not the flex cell. The cell holds an
// input AND a button (2 subject candidates) — the wrapper carries data-vrt-subject.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">antd</span>
            <div className="w-[260px] shrink-0" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">agenta</span>
            <div className="w-[260px] shrink-0" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {onDelete: noop},
    render: () => (
        <div className="flex flex-col max-w-[900px]">
            <Row
                label="placeholder"
                a={<AntdModelNameInput />}
                s={<ModelNameInput onDelete={noop} value="" onChange={noop} />}
            />
            <Row
                label="with value"
                a={<AntdModelNameInput value="gpt-4o-mini" />}
                s={<ModelNameInput onDelete={noop} value="gpt-4o-mini" onChange={noop} />}
            />
            <Row
                label="disabled"
                a={<AntdModelNameInput value="gpt-4o-mini" disabled />}
                s={<ModelNameInput onDelete={noop} value="gpt-4o-mini" disabled onChange={noop} />}
            />
        </div>
    ),
}
