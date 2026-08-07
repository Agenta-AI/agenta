import {MessagesSchemaControl} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Typography} from "antd"
import clsx from "clsx"

// MessagesSchemaControl — schema-driven chat-message array editor. The whole message UI is
// `ChatMessageList` (@agenta/ui, already antd-free); the only antd this file carried was
// `Typography.Text` for the label / description / "No messages" lines, so those three text
// runs are what the parity grid pairs.
const meta = {
    title: "@agenta/entity-ui/DrillIn/MessagesSchemaControl",
    component: MessagesSchemaControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Chat-message array control. antd `Typography.Text` → plain `<span>` + semantic token classes (`text-colorText` / `text-colorTextSecondary`).",
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

// ---------------------------------------------------------------------------
// Parity: the migrated text runs vs their antd Typography originals
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

/** The pre-migration empty branch, verbatim. */
function AntdDisabledEmpty({label, className}: {label: string; className?: string}) {
    return (
        <div className={clsx("flex flex-col gap-1", className)}>
            {label && <Typography.Text className="text-sm font-medium">{label}</Typography.Text>}
            <Typography.Text type="secondary" className="text-xs">
                No messages
            </Typography.Text>
        </div>
    )
}

export const AntdVsAgenta: Story = {
    args: {schema: MESSAGES_SCHEMA, label: "Messages", value: [], onChange: () => undefined},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="field label"
                a={<Typography.Text className="text-sm font-medium">Messages</Typography.Text>}
                s={<span className="text-sm font-medium text-colorText">Messages</span>}
            />
            <Row
                label="description"
                a={
                    <Typography.Text type="secondary" className="text-xs">
                        The conversation seed sent with every run.
                    </Typography.Text>
                }
                s={
                    <span className="text-xs text-colorTextDescription">
                        The conversation seed sent with every run.
                    </span>
                }
            />
            <Row
                label="disabled + empty"
                a={<AntdDisabledEmpty label="Messages" />}
                s={
                    <MessagesSchemaControl
                        schema={MESSAGES_SCHEMA}
                        label="Messages"
                        value={[]}
                        disabled
                        onChange={() => undefined}
                    />
                }
            />
        </div>
    ),
}
