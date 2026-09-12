/**
 * The connection card's copy rules.
 *
 * Every string the card composes from live data lives here rather than in the component: the
 * counts, the pluralisation, and the punctuation the API's own message does not carry. Pure
 * functions, so the wording is pinned by tests instead of by reading JSX.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Provider connection card").
 */

import {secretKindForProviderKind} from "./providerCatalog"
import {SecretKind} from "./types"

/**
 * The green-dot status line: the provider's own verdict, then what the same call fetched.
 *
 * The API ends its verdict with a full stop ("OpenAI accepted this key."), which the middle dot
 * would then read past. Strip it and let the separator do the work.
 */
export const credentialStatusLine = (message: string, modelCount: number | null): string => {
    const verdict = message.trim()
    if (modelCount === null) return verdict
    const stripped = verdict.replace(/\.$/, "")
    return `${stripped} · ${modelCount} ${modelCount === 1 ? "model" : "models"} fetched`
}

/** The header's live count — checked against fetched, never a claim about defaults. */
export const activeModelsCount = (checked: number, total: number): string =>
    `${checked} of ${total}`

/**
 * How many model rows mount before the list collapses behind "Show all N".
 *
 * This is a DOM budget, not a layout one. The list has its own scroller and the drawer body scrolls
 * behind it, so length costs nothing visually — the only real concern is mounting a few hundred rows
 * for an endpoint that serves them. A typical provider returns 25-40 models, which is the design's
 * normal case and must render whole.
 */
export const MODEL_LIST_RENDER_CAP = 60

/**
 * What the model list renders, and whether "Show all N" belongs under it.
 *
 * The rule the founder fixed: "Show all" may never appear while every row is already on screen. So
 * truncation is decided by the row count ALONE — never by available height — and once the user has
 * asked for the full list it stays asked for.
 */
export const modelListView = ({
    total,
    showAll,
}: {
    total: number
    showAll: boolean
}): {truncated: boolean; visibleCount: number} => {
    const truncated = !showAll && total > MODEL_LIST_RENDER_CAP
    return {truncated, visibleCount: truncated ? MODEL_LIST_RENDER_CAP : total}
}

/**
 * The one line under the credential field.
 *
 * A standard provider is tested by its key; a credential-set connection is tested by reaching the
 * address it names, which is what "the key" would misdescribe for Bedrock, Vertex, and an
 * OpenAI-compatible endpoint alike.
 */
export const secretNoteForKind = (kind: string, title: string): string =>
    secretKindForProviderKind(kind) === SecretKind.ProviderKey
        ? `Test checks the key with ${title} and fetches its model list. Nothing is saved until Done.`
        : "Test pings the endpoint and fetches its model list. Nothing is saved until Done."

/** What a manual model id is being added against — the API's list, or one endpoint's. */
export const manualModelPlaceholderForKind = (kind: string): string =>
    secretKindForProviderKind(kind) === SecretKind.ProviderKey
        ? "Add a model ID the API doesn't list"
        : "Add a model ID the endpoint doesn't list"

/**
 * The collapsed Harnesses row's value — always shown, so the section can stay closed without
 * hiding what it decided.
 */
export const harnessSummary = (labels: string[], unrestricted: boolean): string => {
    if (labels.length === 0) {
        return unrestricted ? "any harness Agenta supports" : "no harness selected"
    }
    if (labels.length === 1) return `enabled in ${labels[0]}`
    return `enabled in ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

/** "just now" / "3 min ago" / "2 h ago" — enough to judge whether the fetched list is stale. */
export const relativeFetchTime = (iso: string): string => {
    const elapsed = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(elapsed) || elapsed < 0) return "just now"

    const minutes = Math.floor(elapsed / 60_000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes} min ago`

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} h ago`
    return `${Math.floor(hours / 24)} d ago`
}
