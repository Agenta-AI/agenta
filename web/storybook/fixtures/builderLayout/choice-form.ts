import type {ElicitationDockState} from "@agenta/chat/hooks"
import type {ClientToolMeta} from "@agenta/chat/skin"

/**
 * One recorded `request_input` call of the builder: the "Decisions for you" form. Two single
 * choices (each a `oneOf` list with the recommended option first and set as `default`) and one
 * free-text field (`format: "multiline"`). The shape follows the tool description in
 * `api/oss/src/core/workflows/static_catalog.py`.
 */
export const CHOICE_FORM_INPUT = {
    message: "Two decisions before I build the agent.",
    requestedSchema: {
        type: "object",
        properties: {
            trigger: {
                type: "string",
                title: "When should the agent run?",
                oneOf: [
                    {
                        const: "new_ticket",
                        title: "On every new ticket",
                        description: "Recommended. The agent starts when a ticket arrives.",
                    },
                    {
                        const: "daily",
                        title: "Once a day",
                        description: "The agent reads all new tickets in one pass each morning.",
                    },
                ],
                default: "new_ticket",
            },
            reply: {
                type: "string",
                title: "What should it do with its reply?",
                oneOf: [
                    {
                        const: "draft",
                        title: "Save it as a draft",
                        description: "Recommended. A person reads the draft and sends it.",
                    },
                    {
                        const: "send",
                        title: "Send it",
                        description: "The agent sends the reply on its own.",
                    },
                ],
                default: "draft",
            },
            notes: {
                type: "string",
                title: "Anything else I should know?",
                format: "multiline",
            },
        },
        required: ["trigger", "reply"],
        "x-ag-order": ["trigger", "reply", "notes"],
    },
}

/** What a person types in the free-text field of the story and the unit test. */
export const CHOICE_FORM_NOTES = "Escalate any ticket that mentions a refund."

/** The parked call, as the dock reads it from the transcript. */
const CHOICE_FORM_META = {
    toolCallId: "call_choice_form",
    toolName: "request_input",
    renderKind: "elicitation",
    state: "input-available",
    input: CHOICE_FORM_INPUT,
    output: undefined,
    settled: false,
    part: {},
} as unknown as ClientToolMeta

export const makeChoiceFormDockState = (): ElicitationDockState =>
    ({
        open: true,
        front: CHOICE_FORM_META,
        queue: [CHOICE_FORM_META],
        shortcutsEnabled: true,
        dismiss: async () => undefined,
        settle: async () => true,
        settlingIds: new Set<string>(),
    }) as ElicitationDockState
