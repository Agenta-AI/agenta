/**
 * What a provider connection saved from the ONBOARDING path does to the agent's model.
 *
 * First-run flow: the project has no usable credential, the connect-model gate offers the providers
 * drawer, and the user connects (say) OpenRouter. The agent is still pointed at the seeded default
 * model, whose provider has no key — so the chat stays stuck behind the same gate it just cleared.
 * A connection made from that path therefore also becomes the agent's model.
 *
 * Two rules keep it from surprising anyone:
 *
 *  - It is scoped to onboarding. Adding a SECOND connection mid-session, from the picker's own
 *    "Add provider" footer, leaves the current model alone — the user was configuring providers,
 *    not choosing a model.
 *  - It never switches blindly. A connection offering no models (an endpoint with no discovery and
 *    nothing added by hand) yields no selection, and the caller opens the model picker instead.
 *
 * Pure on purpose: the caller supplies the picker rows and the keys it saw before the save, so the
 * decision is testable without a vault, a drawer, or a React tree. The row itself composes the
 * model id, provider family, connection slug and harness (`selectionFromModelRow`), so this never
 * re-derives any of them.
 */
import {selectionFromModelRow} from "@agenta/entity-ui/drill-in"
import type {PickerConnectionRow, PickerSelection} from "@agenta/entity-ui/drill-in"

export interface OnboardingModelSwitchArgs {
    /**
     * Whether the drawer was opened from an onboarding affordance — the connect-model gate or the
     * empty-state pill — as opposed to the picker's "Add provider" footer mid-session.
     */
    onboarding: boolean
    /** Connection row keys present BEFORE the save, so the added one can be told apart. */
    previousConnectionKeys: readonly string[]
    /** The picker's first-level rows AFTER the save (subscriptions included; they are skipped). */
    rows: readonly PickerConnectionRow[]
}

/**
 * The model to switch to after an onboarding save, or null to leave the config alone.
 *
 * The new connection's FIRST model: `buildConnectionPickerRows` already orders a connection's
 * models by its saved list (or the provider's defaults when it saved none), so entry one is the
 * default the catalog would have offered anyway — in the harness spelling, paired with the first
 * harness that can drive it.
 */
export const onboardingModelSwitch = ({
    onboarding,
    previousConnectionKeys,
    rows,
}: OnboardingModelSwitchArgs): PickerSelection | null => {
    if (!onboarding) return null
    const known = new Set(previousConnectionKeys)
    // Subscriptions are ambient (a mounted login), never "the connection just created".
    const added = rows.find((row) => row.kind === "connection" && !known.has(row.key))
    const first = added?.models[0]
    return first ? selectionFromModelRow(first) : null
}
