import {MessagesSchemaControl} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// MessagesSchemaControl — schema-driven chat-message array editor. The message UI is
// `ChatMessageList` (@agenta/ui); the control adds the label, description and "No messages"
// text runs.
const meta = {
    title: "@agenta/entity-ui/DrillIn/MessagesSchemaControl",
    component: MessagesSchemaControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Chat-message array control: an optional label and description over the editable message list.",
            },
        },
    },
} satisfies Meta<typeof MessagesSchemaControl>

export default meta
type Story = StoryObj<typeof meta>

const MESSAGES_SCHEMA = {
    type: "array",
    "x-parameter": "messages",
    items: {
        type: "object",
        properties: {role: {type: "string"}, content: {type: "string"}},
    },
}

const MESSAGES = [
    {role: "system", content: "You are a terse assistant."},
    {role: "user", content: "Summarise {{document}} in one line."},
]

/** Editable list with a label. */
export const Default: Story = {
    args: {
        schema: MESSAGES_SCHEMA,
        label: "Messages",
        value: MESSAGES,
        onChange: () => undefined,
    },
}

/** Label + description (the secondary text branch). */
export const WithDescription: Story = {
    args: {
        schema: MESSAGES_SCHEMA,
        label: "Messages",
        description: "The conversation seed sent with every run.",
        value: MESSAGES,
        onChange: () => undefined,
    },
}

/** No label at all — both text runs are conditional. */
export const NoLabel: Story = {
    args: {schema: MESSAGES_SCHEMA, label: "", value: MESSAGES, onChange: () => undefined},
}

/** Disabled + empty → the "No messages" branch, which never mounts ChatMessageList. */
export const DisabledEmpty: Story = {
    args: {
        schema: MESSAGES_SCHEMA,
        label: "Messages",
        value: [],
        disabled: true,
        onChange: () => undefined,
    },
}
