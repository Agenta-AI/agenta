import type {CatalogKey} from "@agenta/i18n"
import type analyticsCatalog from "@agenta/i18n/catalogs/observabilityUi.analytics"

type AnalyticsKey = CatalogKey<typeof analyticsCatalog>

/**
 * The failure reasons `categorizeFailure` returns, by their English label. The English label
 * stays the grouping key; only the text on screen goes through the catalog.
 */
const FAILURE_KEYS: Record<string, {label: AnalyticsKey; fix: AnalyticsKey}> = {
    "Could not reach the model": {
        label: "observabilityUi.analytics.failureUnreachable",
        fix: "observabilityUi.analytics.failureUnreachableFix",
    },
    "Out of credits": {
        label: "observabilityUi.analytics.failureNoCredits",
        fix: "observabilityUi.analytics.failureNoCreditsFix",
    },
    "Sandbox did not start": {
        label: "observabilityUi.analytics.failureSandbox",
        fix: "observabilityUi.analytics.failureSandboxFix",
    },
    "Empty prompt": {
        label: "observabilityUi.analytics.failureEmptyPrompt",
        fix: "observabilityUi.analytics.failureEmptyPromptFix",
    },
    "Timed out": {
        label: "observabilityUi.analytics.failureTimeout",
        fix: "observabilityUi.analytics.failureTimeoutFix",
    },
    "Missing API key / connection": {
        label: "observabilityUi.analytics.failureMissingKey",
        fix: "observabilityUi.analytics.failureMissingKeyFix",
    },
    "Other error": {
        label: "observabilityUi.analytics.failureOther",
        fix: "observabilityUi.analytics.failureOtherFix",
    },
}

type Translate = (key: AnalyticsKey) => string

/** A failure reason's label in the active language; an unknown label shows as it is. */
export const failureLabel = (label: string, t: Translate): string => {
    const keys = FAILURE_KEYS[label]
    return keys ? t(keys.label) : label
}

/** The fix to try for a failure reason, in the active language. */
export const failureFix = (label: string, fix: string, t: Translate): string => {
    const keys = FAILURE_KEYS[label]
    return keys ? t(keys.fix) : fix
}
