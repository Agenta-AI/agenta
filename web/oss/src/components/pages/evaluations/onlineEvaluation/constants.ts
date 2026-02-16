import {getEvaluatorTags} from "@/oss/lib/helpers/evaluate"

export const EVALUATOR_CATEGORY_ENTRIES = getEvaluatorTags()

export const EVALUATOR_CATEGORY_LABEL_MAP = EVALUATOR_CATEGORY_ENTRIES.reduce<
    Record<string, string>
>((acc, {value, label}) => {
    acc[value.toLowerCase()] = label
    return acc
}, {})

export const PARAMETER_KEYS_TO_IGNORE = new Set([
    "ag_config",
    "agconfig",
    "prompt_template",
    "prompttemplate",
    "prompt",
    "prompts",
    "messages",
    "outputs",
])

export const MAX_PARAMETER_PREVIEW_LENGTH = 400

export const PARAMETER_KEYS_TO_HIDE = new Set<string>()

export const PROMPT_KEY_LOOKUP = new Set(
    ["prompt", "system_prompt", "systemprompt", "template", "instruction"].map((key) =>
        key.toLowerCase(),
    ),
)

export const ENABLE_CORRECT_ANSWER_KEY_FILTER =
    process.env.NEXT_PUBLIC_ENABLE_CORRECT_ANSWER_KEY_FILTER === "true"

export const ALLOWED_ONLINE_EVALUATOR_KEYS = new Set([
    "auto_regex_test",
    "regex_test",
    "auto_custom_code_run",
    "custom_code_run",
    "auto_webhook_test",
    "webhook_test",
    "auto_ai_critique",
    "ai_critique",
])
