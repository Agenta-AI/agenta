import {useMemo, useRef, useState} from "react"

import {
    eventFieldLabels,
    eventFieldsFromSchema,
    parseMessageTemplate,
    templateSelectors,
} from "@agenta/entities/gatewayTrigger"
import {EventFieldCards, EventMessageComposer} from "@agenta/entity-ui/gatewayTrigger"
import type {Meta, StoryObj} from "@storybook/nextjs"

// EventMessageComposer + EventFieldCards — an event automation's instruction. A card click adds
// the field as a pill, stored as a `$.event.attributes.<key>` text part.
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/EventMessageComposer",
    component: EventMessageComposer,
    parameters: {layout: "padded"},
} satisfies Meta<typeof EventMessageComposer>

export default meta
type Story = StoryObj<typeof meta>

const PULL_REQUEST_SCHEMA = {
    type: "object",
    properties: {
        action: {type: "string", description: "The action that was performed"},
        createdBy: {type: "string", description: "Who opened the pull request"},
        number: {type: "integer", description: "The pull request number"},
        title: {type: "string", description: "The pull request title"},
        url: {type: "string", description: "Link to the pull request"},
    },
}
const WITH_PILL = JSON.stringify({
    messages: [
        {
            role: "user",
            content: [
                {type: "text", text: "Review "},
                {type: "text", text: "$.event.attributes.title"},
            ],
        },
    ],
})
const RICH_MAPPING = JSON.stringify({
    messages: [
        {role: "system", content: "Be brief."},
        {role: "user", content: "Triage it"},
    ],
})

const Row = ({label, initial, schema}: {label: string; initial: string; schema?: unknown}) => {
    const [inputsText, setInputsText] = useState(initial)
    const groups = useMemo(() => eventFieldsFromSchema(schema ?? null), [schema])
    const labels = useMemo(() => eventFieldLabels(groups), [groups])
    const used = useMemo(
        () => new Set(templateSelectors(parseMessageTemplate(inputsText, true, "messages") ?? "")),
        [inputsText],
    )
    const insertApi = useRef<{insert: (selector: string) => void} | null>(null)
    return (
        <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-4">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <div className="flex max-w-[560px] flex-col gap-4">
                <EventMessageComposer
                    inputsText={inputsText}
                    onChange={setInputsText}
                    isChat
                    primaryKey="messages"
                    labels={labels}
                    insertApi={insertApi}
                />
                <EventFieldCards
                    groups={groups}
                    used={used}
                    onInsert={(card) => insertApi.current?.insert(card.selector)}
                />
            </div>
        </div>
    )
}

export const States: Story = {
    args: {
        inputsText: "{}",
        onChange: () => undefined,
        isChat: true,
        primaryKey: "messages",
        labels: {},
    },
    render: () => (
        <div className="flex flex-col">
            <Row label="Empty" initial="{}" schema={PULL_REQUEST_SCHEMA} />
            <Row label="With a pill" initial={WITH_PILL} schema={PULL_REQUEST_SCHEMA} />
            <Row label="No schema" initial={WITH_PILL} />
            <Row label="Richer mapping" initial={RICH_MAPPING} schema={PULL_REQUEST_SCHEMA} />
        </div>
    ),
}
