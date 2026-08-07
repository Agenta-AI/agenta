import {LoadEvaluatorPresetModal} from "@agenta/entity-ui/modals"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * Props-only modal (0 atom reads): the preset list, selection, and preview all flow
 * through props, so no data seam is needed — plain args suffice.
 */
const meta = {
    title: "@agenta/entity-ui/Modals/LoadEvaluatorPresetModal",
    component: LoadEvaluatorPresetModal,
    // The modal portals to <body>; a docs page rendering all stories would stack dialogs.
    tags: ["!autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Evaluator preset chooser: searchable preset list on the left, YAML/JSON " +
                    "preview on the right.",
            },
        },
    },
} satisfies Meta<typeof LoadEvaluatorPresetModal>

export default meta
type Story = StoryObj<typeof meta>

const PRESETS = [
    {
        key: "exact-match",
        name: "Exact match",
        values: {
            correct_answer_key: "correct_answer",
            case_sensitive: true,
        },
    },
    {
        key: "contains-json",
        name: "Contains JSON",
        values: {
            expected_keys: ["answer", "confidence"],
            allow_extra_keys: false,
        },
    },
    {
        key: "llm-judge",
        name: "LLM-as-a-judge",
        values: {
            model: "gpt-4o-mini",
            prompt: "Rate the answer between 1 and 10 for factual accuracy.",
            temperature: 0,
        },
    },
]

export const Default: Story = {
    args: {
        open: true,
        presets: PRESETS,
        onLoadPreset: () => {},
        onCancel: () => {},
    },
}

/** No presets available — the list renders empty and Load stays disabled. */
export const Empty: Story = {
    args: {
        open: true,
        presets: [],
        onLoadPreset: () => {},
        onCancel: () => {},
    },
}
