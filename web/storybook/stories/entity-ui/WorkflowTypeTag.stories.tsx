import type {EvaluatorCatalogTemplate} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

// WorkflowTypeTag — the workflow "Type" pill (apps + evaluators): a `Badge` preset variant
// inside a `Tooltip`.
const meta = {
    title: "@agenta/entity-ui/Workflow/WorkflowTypeTag",
    component: WorkflowTypeTag,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Unified Type tag for workflow rows (apps + evaluators), rendered as a `@agenta/ui` `Badge` inside a `Tooltip`. The evaluator branch reads the evaluator template catalog atom (data-seam stories below).",
            },
        },
    },
} satisfies Meta<typeof WorkflowTypeTag>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

// One workflow-type key per preset hue the color map produces. All 13 map to Badge
// preset variants.
const TYPE_PER_HUE: [string, string][] = [
    ["chat", "blue"],
    ["completion", "cyan"],
    ["custom", "gold"],
    ["auto_exact_match", "green"],
    ["auto_regex_test", "orange"],
    ["auto_ends_with", "red"],
    ["ai_llm", "purple"],
    ["auto_contains_json", "magenta"],
    ["auto_json_diff", "volcano"],
    ["auto_semantic_similarity", "geekblue"],
    ["auto_webhook_test", "lime"],
    ["auto_similarity_match", "pink"],
    ["auto_starts_with", "yellow"],
]

/** App branch (pure props — no atom reads). One row per preset hue. */
export const Variants: Story = {
    args: {isEvaluator: false, workflowType: "chat"},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            {TYPE_PER_HUE.map(([type, hue]) => (
                <Row key={type} label={`${type} (${hue})`}>
                    <WorkflowTypeTag isEvaluator={false} workflowType={type} />
                </Row>
            ))}
            <Row label="unknown type (no preset)">
                <WorkflowTypeTag isEvaluator={false} workflowType="Some Custom Thing" />
            </Row>
            <Row label="long label (truncates at 160px)">
                <WorkflowTypeTag
                    isEvaluator={false}
                    workflowType="__main__.MyVeryLongCustomEvaluatorName"
                />
            </Row>
        </div>
    ),
}

// ---------------------------------------------------------------------------
// Data-seam stories — the evaluator branch reads `evaluatorTemplatesDataAtom`
// (query key `["evaluatorTemplates", projectId]` — evaluatorTemplateAtoms.ts:31).
// The templates API has no zod schema (plain interface), so the fixture is typed
// with `EvaluatorCatalogTemplate` instead.
// ---------------------------------------------------------------------------

const templatesFixture = (
    templates: EvaluatorCatalogTemplate[],
): {count: number; templates: EvaluatorCatalogTemplate[]} => ({
    count: templates.length,
    templates,
})

/** Evaluator whose key resolves to a catalog template — label comes from the template name. */
export const EvaluatorFromTemplate: Story = {
    args: {isEvaluator: true, workflowKey: "auto_exact_match"},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => [
                [
                    ["evaluatorTemplates", scope.projectId],
                    templatesFixture([
                        {
                            key: "auto_exact_match",
                            name: "Exact Match",
                            categories: ["match"],
                        },
                    ]),
                ],
            ],
        },
    },
}

/** Evaluator key with NO matching template — falls back to the raw key + key-derived color. */
export const EvaluatorUnknownKey: Story = {
    args: {isEvaluator: true, workflowKey: "__main__.MyEvaluator"},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => [
                [["evaluatorTemplates", scope.projectId], templatesFixture([])],
            ],
        },
    },
}

/** Evaluator with only a category/subtype key (`ai_llm` → purple). */
export const EvaluatorByTypeKey: Story = {
    args: {isEvaluator: true, evaluatorTypeKey: "ai_llm"},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => [
                [["evaluatorTemplates", scope.projectId], templatesFixture([])],
            ],
        },
    },
}
