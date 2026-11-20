/**
 * The provider connection card's text in the active language: the Test hint, the model counts,
 * the fetch time and the probe failures. `@agenta/entities` keeps the rules (which kind is tested
 * by its key, when a probe failure is the server's own words); this module gives them words.
 * Read on every render, so the text follows the language.
 */
import {
    credentialSummary,
    probeFailureMessage,
    secretKindForProviderKind,
    SecretKind,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {createT, formatList, formatLocale, formatRelativeTime} from "@agenta/i18n"
import providerConnectionCatalog from "@agenta/i18n/catalogs/entityUi.providerConnection"

const tNow = createT(providerConnectionCatalog)

const testedByKey = (kind: string) => secretKindForProviderKind(kind) === SecretKind.ProviderKey

/**
 * The Test button's hint. A standard provider is tested by its key; a credential-set connection
 * is tested by reaching the address it names, which "the key" would misdescribe for Bedrock,
 * Vertex and an OpenAI-compatible endpoint alike.
 */
export const testNote = (kind: string, provider: string): string =>
    testedByKey(kind)
        ? tNow("entityUi.providerConnection.testNoteKey", {provider})
        : tNow("entityUi.providerConnection.testNoteEndpoint")

/** What a manual model ID is added against: the API's list, or one endpoint's. */
export const manualModelPlaceholder = (kind: string): string =>
    testedByKey(kind)
        ? tNow("entityUi.providerConnection.addModelIdApi")
        : tNow("entityUi.providerConnection.addModelIdEndpoint")

/**
 * The status line: the provider's own verdict, then what the same call fetched.
 *
 * The API ends its verdict with a full stop ("OpenAI accepted this key."), which the middle dot
 * would then read past. Strip it and let the separator do the work.
 */
export const credentialStatusLine = (message: string, modelCount: number | null): string => {
    const verdict = message.trim().replace(/\.$/, "")
    if (modelCount === null) return verdict
    return `${verdict} · ${tNow("entityUi.providerConnection.modelsFetched", {count: modelCount})}`
}

/** The Active models header's count: checked against fetched, never a claim about defaults. */
export const activeModelsCount = (checked: number, total: number): string =>
    tNow("entityUi.providerConnection.activeModelsCount", {checked, total})

/**
 * "just now" / "3 min ago" / "2 h ago": enough to judge whether the fetched list is stale.
 * English keeps these exact words; another language gets the same steps from
 * `Intl.RelativeTimeFormat` ("il y a 3 min", "3 分前").
 */
export const relativeFetchTime = (iso: string): string => {
    const english = formatLocale() === undefined
    const elapsed = Date.now() - new Date(iso).getTime()
    // A clock-skewed future timestamp reads as just now, not as a negative age.
    const minutes = Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / 60_000) : 0
    if (minutes < 1) return english ? "just now" : formatRelativeTime(0, "second")
    if (minutes < 60) return english ? `${minutes} min ago` : formatRelativeTime(-minutes, "minute")

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return english ? `${hours} h ago` : formatRelativeTime(-hours, "hour")

    const days = Math.floor(hours / 24)
    return english ? `${days} d ago` : formatRelativeTime(-days, "day")
}

/** Why a Test gave no verdict: the connection is gone, the server's own words, or no answer. */
export const probeFailureText = (error: unknown, provider: string): string =>
    probeFailureMessage(error, {
        gone: tNow("entityUi.providerConnection.connectionGone"),
        unreachable: tNow("entityUi.providerConnection.couldNotReach", {provider}),
    })

/** The Credential summary: the masked key, the endpoint host, or "Key configured". */
export const credentialSummaryText = (connection: ProviderConnection): string =>
    credentialSummary(connection, tNow("entityUi.providerConnection.keyConfiguredLabel"))

/**
 * The connected row's one subtitle: `sk-••••AAA · 3 models · Pi, Claude Code`. A part with
 * nothing to say (no credential, no harness policy) drops out rather than leaving an empty segment.
 */
export const connectedRowSubtitle = ({
    credential,
    modelCount,
    harnessLabels,
}: {
    credential: string
    modelCount: number
    harnessLabels: string[]
}): string =>
    [
        credential && credential !== "—" ? credential : "",
        tNow("entityUi.providerConnection.modelCount", {count: modelCount}),
        formatList(harnessLabels),
    ]
        .filter(Boolean)
        .join(" · ")
