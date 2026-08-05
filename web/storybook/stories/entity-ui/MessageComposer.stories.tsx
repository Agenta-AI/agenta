import {getScheduleMessage} from "@agenta/entities/gatewayTrigger"
import {MessageComposer} from "@agenta/entity-ui/gatewayTrigger"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input as AntInput, Typography as AntTypography} from "antd"

// MessageComposer — the schedule drawer's "what should the agent do?" editor. The antd
// cell replays the pre-migration COMPOSE branch verbatim from feat/storybook-data-seam
// (`Input.TextArea autoSize` + `Typography.Text`/`Typography.Link`); the raw-JSON branch
// is the shared Editor in both halves, so it isn't compared. The agenta cell renders the
// migrated component (`AutosizeTextarea` + token-classed spans/link-buttons).
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/MessageComposer",
    component: MessageComposer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'antd `Input.TextArea autoSize` → `@agenta/ui` `AutosizeTextarea`; `Typography.Text type="secondary"/"warning"` → spans on `--ag-colorTextDescription`/`--ag-colorWarningText` (the exact antd Typography tokens); `Typography.Link` → a link-button on the `btn-link` tokens.',
            },
        },
    },
} satisfies Meta<typeof MessageComposer>

export default meta
type Story = StoryObj<typeof meta>

const CHAT_MESSAGE = JSON.stringify({
    messages: [{role: "user", content: "Summarize yesterday's support tickets."}],
})
const RICH_MAPPING = JSON.stringify({inputs: {topic: "$.event.attributes.topic"}})

const noop = () => undefined

/** Pre-migration compose branch, verbatim. */
const AntdComposer = ({
    inputsText,
    isChat,
    primaryKey,
    disabled,
}: {
    inputsText: string
    isChat: boolean
    primaryKey: string
    disabled?: boolean
}) => {
    const message = getScheduleMessage(inputsText, isChat, primaryKey)
    const wouldReplace = !message && !!inputsText.trim() && inputsText.trim() !== "{}"
    return (
        <div className="flex flex-col gap-1.5">
            <AntInput.TextArea
                placeholder="Summarize yesterday's support tickets and post the digest to #ops."
                value={message}
                autoSize={{minRows: 2, maxRows: 6}}
                disabled={disabled}
            />
            <div className="flex items-center justify-between gap-2">
                <AntTypography.Text
                    type={wouldReplace ? "warning" : "secondary"}
                    className="!text-[11px] leading-snug"
                >
                    {wouldReplace ? (
                        "This mapping is richer than one message — typing here replaces it. Edit it under Advanced."
                    ) : (
                        <>
                            Sent to the agent{" "}
                            {isChat ? "as the user message" : `as the "${primaryKey}" input`} on
                            each run.
                        </>
                    )}
                </AntTypography.Text>
                <AntTypography.Link className="!shrink-0 !text-[11px]">
                    Advanced — raw JSON
                </AntTypography.Link>
            </div>
        </div>
    )
}

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[380px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[380px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {inputsText: "{}", onChange: noop, isChat: true, primaryKey: "messages"},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="empty (placeholder)"
                a={<AntdComposer inputsText="{}" isChat primaryKey="messages" />}
                s={<MessageComposer inputsText="{}" onChange={noop} isChat primaryKey="messages" />}
            />
            <Row
                label="chat message"
                a={<AntdComposer inputsText={CHAT_MESSAGE} isChat primaryKey="messages" />}
                s={
                    <MessageComposer
                        inputsText={CHAT_MESSAGE}
                        onChange={noop}
                        isChat
                        primaryKey="messages"
                    />
                }
            />
            <Row
                label="richer mapping (warning)"
                a={<AntdComposer inputsText={RICH_MAPPING} isChat={false} primaryKey="message" />}
                s={
                    <MessageComposer
                        inputsText={RICH_MAPPING}
                        onChange={noop}
                        isChat={false}
                        primaryKey="message"
                    />
                }
            />
            <Row
                label="disabled"
                a={<AntdComposer inputsText={CHAT_MESSAGE} isChat primaryKey="messages" disabled />}
                s={
                    <MessageComposer
                        inputsText={CHAT_MESSAGE}
                        onChange={noop}
                        isChat
                        primaryKey="messages"
                        disabled
                    />
                }
            />
        </div>
    ),
}
