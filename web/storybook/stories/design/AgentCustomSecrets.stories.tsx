import type {Meta, StoryObj} from "@storybook/nextjs"

function DesignerPrototype({
    scenario = "happy",
    entry = "request",
    theme = "light",
}: {
    scenario?: string
    entry?: string
    theme?: string
}) {
    const query = new URLSearchParams({scenario, entry, theme})
    return (
        <iframe
            title="Agent custom secrets designer prototype"
            src={`/agent-custom-secrets/Agent%20custom%20secrets.dc.html?${query}`}
            className="h-screen w-full border-0"
        />
    )
}

const meta = {
    title: "Design review/Agent custom secrets",
    component: DesignerPrototype,
    parameters: {layout: "fullscreen"},
    tags: ["!autodocs"],
    render: (args, context) => (
        <DesignerPrototype {...args} theme={context.globals.theme ?? "light"} />
    ),
} satisfies Meta<typeof DesignerPrototype>
export default meta
type Story = StoryObj<typeof meta>
export const AgentChoosesExisting: Story = {args: {entry: "request"}}
export const AgentCreatesSecret: Story = {args: {entry: "create"}}
export const SettingsCreateSecret: Story = {args: {entry: "settings"}}
export const ManualAttachmentAndOverride: Story = {args: {entry: "manual"}}
export const SavedButNotAttached: Story = {args: {scenario: "attachFails", entry: "create"}}
export const ResumeFails: Story = {args: {scenario: "resumeFails"}}
export const ReloadAfterAttachment: Story = {args: {scenario: "reload"}}
