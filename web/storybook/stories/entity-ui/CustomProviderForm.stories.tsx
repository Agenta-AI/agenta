import {useRef} from "react"

import {CustomProviderForm, type CustomProviderFormHandle} from "@agenta/entity-ui/secretProvider"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * Showcase story for `CustomProviderForm`. The form uses controlled state with submit-time
 * validation, and exposes an imperative `CustomProviderFormHandle`
 * (`formRef.submit()/reset()`); the footer buttons here drive it exactly the way the
 * ConfigureProviderDrawer host does.
 */
const meta = {
    title: "@agenta/entity-ui/SecretProvider/CustomProviderForm",
    component: CustomProviderForm,
} satisfies Meta<typeof CustomProviderForm>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const HostedForm = ({
    selectedProvider,
    initialProviderKind,
}: {
    selectedProvider?: Parameters<typeof CustomProviderForm>[0]["selectedProvider"]
    initialProviderKind?: string
}) => {
    const formRef = useRef<CustomProviderFormHandle | null>(null)
    return (
        <div className="w-[440px] flex flex-col gap-4">
            <CustomProviderForm
                formRef={formRef}
                onClose={noop}
                selectedProvider={selectedProvider}
                initialProviderKind={initialProviderKind}
            />
            <div className="flex justify-end items-center gap-2">
                <Button variant="outline" onClick={() => formRef.current?.reset()}>
                    Cancel
                </Button>
                <Button variant="default" onClick={() => formRef.current?.submit()}>
                    Submit
                </Button>
            </div>
        </div>
    )
}

/** Empty add-flow: only the provider select until a provider is chosen. */
export const NewProvider: Story = {
    args: {onClose: noop},
    render: () => <HostedForm />,
}

/** Pre-selected kind (rail "Add Bedrock" row) — credential fields visible. */
export const PreselectedKind: Story = {
    args: {onClose: noop},
    render: () => <HostedForm initialProviderKind="bedrock" />,
}

/** Edit flow: existing provider values prefilled, including the model list. */
export const EditProvider: Story = {
    args: {onClose: noop},
    render: () => (
        <HostedForm
            selectedProvider={{
                id: "sp-story-1",
                provider: "openai",
                name: "my-openai",
                apiKey: "sk-not-a-real-key",
                models: ["gpt-4o", "gpt-4o-mini"],
            }}
        />
    ),
}

/** Submit with empty fields to see the validation errors (interactive). */
export const ValidationErrors: Story = {
    args: {onClose: noop},
    render: () => <HostedForm initialProviderKind="openai" />,
}
