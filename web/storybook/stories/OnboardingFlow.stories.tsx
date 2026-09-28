import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import OnboardingFlowView from "@agenta/oss/src/components/OnboardingFlow/OnboardingFlowView"
import type {Meta, StoryObj} from "@storybook/nextjs"

const templates = [
    {
        key: "pr-reviewer",
        name: "PR reviewer",
        category: "Engineering",
        description: "Reviews open pull requests and leaves comments.",
        connections: [],
        example: {
            prompt: "Review my open pull requests",
            steps: ["Read the diff", "Check the tests"],
            reply: "Two pull requests reviewed.",
        },
    },
] as unknown as AgentStarterTemplate[]

const meta = {
    title: "Onboarding/Signup flow",
    component: OnboardingFlowView,
    parameters: {layout: "fullscreen"},
    args: {
        variant: "control",
        catalog: {templates, status: "success", retry: () => undefined},
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
export const TemplatesUnavailable: Story = {
    args: {catalog: {templates: [], status: "error", retry: () => undefined}},
}
export const Creating: Story = {args: {committing: true}}
