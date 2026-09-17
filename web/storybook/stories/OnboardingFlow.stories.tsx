import OnboardingFlowView from "@agenta/oss/src/components/OnboardingFlow/OnboardingFlowView"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "Onboarding/Signup flow",
    component: OnboardingFlowView,
    parameters: {layout: "fullscreen"},
    args: {
        variant: "control",
        tools: <p>Connect apps here, or continue without tools.</p>,
        model: <p>A model is ready.</p>,
        modelReady: true,
        modelNextLabel: "Continue with credits",
        committing: false,
        onCreate: () => undefined,
        onStep: () => undefined,
    },
} satisfies Meta<typeof OnboardingFlowView>
export default meta
type Story = StoryObj<typeof meta>
export const NameFirst: Story = {}
export const TaskFirst: Story = {args: {variant: "task-first"}}
export const MissingModel: Story = {
    args: {modelReady: false, model: <p role="alert">Connect a model to continue.</p>},
}
export const ToolsUnavailable: Story = {
    args: {
        tools: <p role="alert">Tools couldn't load. You can continue and connect them later.</p>,
    },
}
export const Creating: Story = {args: {committing: true}}
