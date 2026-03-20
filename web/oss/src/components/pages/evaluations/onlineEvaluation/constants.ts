import {getEvaluatorTags} from "@/oss/lib/evaluations/legacy"

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

/**
 * Legacy fallback: evaluator keys allowed for online (real-time) evaluation.
 *
 * Prefer flag-based detection (`is_code`, `is_hook`, `is_llm`) via
 * `isOnlineCapableEvaluator()` in useEvaluatorSelection. This key set is
 * only used when workflow flags are not populated (pre-GFlags evaluators).
 *
 * After the evaluator key consolidation (managed-workflows.md), these legacy
 * keys will be retired. See frontend/evaluator-key-dependencies.md.
 */
export const ALLOWED_ONLINE_EVALUATOR_KEYS = new Set([
    // Legacy keys (auto_ prefixed)
    "auto_regex_test",
    "auto_custom_code_run",
    "auto_webhook_test",
    "auto_ai_critique",
    // Bare keys (auto_ prefix stripped by collectEvaluatorCandidates)
    "regex_test",
    "custom_code_run",
    "webhook_test",
    "ai_critique",
    // Canonical family keys (post-consolidation)
    "code",
    "hook",
    "prompt",
])
