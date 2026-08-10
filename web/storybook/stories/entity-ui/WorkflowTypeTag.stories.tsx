import {getWorkflowTypeColor, getWorkflowTypeLabel} from "@agenta/entities/workflow"
import type {EvaluatorCatalogTemplate} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag as AntTag, Tooltip as AntTooltip} from "antd"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

// WorkflowTypeTag — the workflow "Type" pill (apps + evaluators). The antd cell replays
// the pre-migration TypePill verbatim (`<Tooltip placement="topLeft"><Tag bordered
// color={presetName}>`). Note antd v6 IGNORES `bordered` (only `bordered={false}` maps to
// a variant), so the pre-migration pill actually rendered the FILLED preset — bg hue-1,
// text hue-7, no border. The agenta cell renders the migrated component: Badge preset
// variants for the 8 bridged hues, `--ant-<hue>-1/-7` cssvar fallback for the rest.
const meta = {
    title: "@agenta/entity-ui/Workflow/WorkflowTypeTag",
    component: WorkflowTypeTag,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Unified Type tag for workflow rows (apps + evaluators). antd `Tag` preset + `Tooltip` → `@agenta/ui` `Badge` + `Tooltip`. The evaluator branch reads the evaluator template catalog atom (data-seam stories below).",
            },
        },
    },
} satisfies Meta<typeof WorkflowTypeTag>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    /** Declares a deliberate divergence: still measured and reported, but not gated. */
    expected?: string
}) => (
    <div
        className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

/** The pre-migration TypePill body, verbatim (antd Tooltip + bordered preset Tag). */
const AntdTypePill = ({workflowType}: {workflowType: string}) => {
    const label = getWorkflowTypeLabel(workflowType) ?? workflowType
    const color = getWorkflowTypeColor(workflowType)
    return (
        <AntTooltip title={label} placement="topLeft">
            <AntTag bordered color={color?.name} className="!m-0 max-w-[160px] truncate">
                {label}
            </AntTag>
        </AntTooltip>
    )
}

// One workflow-type key per preset hue the color map produces. All 13 map to Badge
// preset variants (pink/yellow/volcano/geekblue/lime added post-wave-1; the inline
// `--ant-<hue>-1/-7` cssvar fallback is gone).
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

// Badge preset text colours for these hues sit one/two steps down antd's own ramp for
// WCAG AA (4.5:1) — see `presetTag` in oss/src/styles/theme/palette.ts. purple deviates
// in dark only.
// yellow/lime light text = step 9, volcano light = step 8, geekblue dark = step 8;
// pink's AA step happens to equal antd's own step 7, so it needs no annotation.
const AA_HUES = new Set([
    "green",
    "orange",
    "cyan",
    "gold",
    "purple",
    "yellow",
    "volcano",
    "geekblue",
    "lime",
])
const AA_NOTE =
    "WCAG AA: this hue sits one/two steps down antd's own ramp so preset tags reach 4.5:1 — see presetTag in palette.ts"

/** App branch (pure props — no atom reads). One row per preset hue. */
export const AntdVsAgenta: Story = {
    args: {isEvaluator: false, workflowType: "chat"},
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            {TYPE_PER_HUE.map(([type, hue]) => (
                <Row
                    key={type}
                    label={`${type} (${hue})`}
                    expected={AA_HUES.has(hue) ? AA_NOTE : undefined}
                    a={<AntdTypePill workflowType={type} />}
                    s={<WorkflowTypeTag isEvaluator={false} workflowType={type} />}
                />
            ))}
            <Row
                label="unknown type (no preset)"
                a={<AntdTypePill workflowType="Some Custom Thing" />}
                s={<WorkflowTypeTag isEvaluator={false} workflowType="Some Custom Thing" />}
            />
            <Row
                label="long label (truncates at 160px)"
                a={<AntdTypePill workflowType="__main__.MyVeryLongCustomEvaluatorName" />}
                s={
                    <WorkflowTypeTag
                        isEvaluator={false}
                        workflowType="__main__.MyVeryLongCustomEvaluatorName"
                    />
                }
            />
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
