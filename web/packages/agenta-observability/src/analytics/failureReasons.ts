import type {FailureCategory} from "./types"

/** Raw run errors, matched in order, to a readable reason and the fix to try. */
const REASONS: {match: RegExp; category: FailureCategory}[] = [
    {
        match: /ConnectError|connection attempts failed|APIConnectionError/i,
        category: {
            label: "Could not reach the model",
            fix: "The provider didn’t respond. This is usually temporary, so retrying the run often works.",
        },
    },
    {
        match: /\b402\b|more credits|insufficient[_ ]quota|credit balance/i,
        category: {
            label: "Out of credits",
            fix: "Your provider account ran out of credits. Add credits with the provider, then retry.",
        },
    },
    {
        match: /sandbox/i,
        category: {
            label: "Sandbox did not start",
            fix: "The run environment couldn’t start. Retry the run; if it keeps happening, contact support.",
        },
    },
    {
        match: /no user message/i,
        category: {
            label: "Empty prompt",
            fix: "The run started without a message. Check what triggers this agent and what it sends.",
        },
    },
    {
        match: /timeout|timed out/i,
        category: {
            label: "Timed out",
            fix: "The model took too long to answer. Retry, or switch to a faster model.",
        },
    },
    {
        match: /connection .* not found|no usable credential|ConnectionNotFound|api key/i,
        category: {
            label: "Missing API key / connection",
            fix: "The provider connection is missing or has no key. Add it in Settings → AI providers.",
        },
    },
]

const OTHER: FailureCategory = {
    label: "Other error",
    fix: "Open the run's trace to see the full error.",
}

export const categorizeFailure = (raw: string | null | undefined): FailureCategory =>
    REASONS.find((reason) => raw && reason.match.test(raw))?.category ?? OTHER
