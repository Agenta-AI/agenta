/**
 * pickerSections — the agent picker's flyout, split by harness.
 *
 * A connection's models are offered through every harness that can drive it, so the same model can
 * appear twice in one flyout. Tagging each row with its harness said so, but repeated the same pill
 * down the whole list; grouping says it once. The two shapes the spec asks for fall out of the same
 * split: one harness renders as a `via <name>` lead-in, several as labelled runs.
 *
 * Pure — rows in, groups out — so the grouping and the label/hint split are testable without React.
 *
 * Design: "handoff 5/picker-final" §4 (Flyout — models).
 */

import {splitCuratedLabel} from "@agenta/shared/utils"
import type {ProviderGroup, ProviderSection} from "@agenta/ui/select-llm-provider"

import {modelRowKey, type PickerConnectionRow, type PickerModelRow} from "./connectionPicker"

/** The olive `Subscription` mark, which is the only thing that says a row is not a stored key. */
export const SUBSCRIPTION_TAG = "Subscription"

/**
 * One flyout row.
 *
 * The harness is the SECTION's to name, so the row carries no harness of its own in the flyout.
 * `tag` is set only where the flat search view would otherwise show the same model twice under one
 * connection with nothing to tell the two apart — that view has no sections to name the harness.
 */
const optionFor = (row: PickerConnectionRow, model: PickerModelRow, ambiguous: boolean) => {
    const {name, hint} = splitCuratedLabel(model.label)
    return {
        label: name,
        ...(hint ? {hint} : {}),
        ...(ambiguous ? {tag: model.harnessLabel} : {}),
        value: model.modelId,
        key: modelRowKey(row.key, model),
        // The flat search view has no column to say where a result came from, so it says so itself.
        searchCaption: row.name,
        metadata: {
            ...(model.slug ? {connectionSlug: model.slug} : {}),
            connectionMode: model.mode,
            harness: model.harness,
            ...(model.provider ? {provider: model.provider} : {}),
        },
    }
}

/**
 * The connection's models grouped by harness, in the order the harnesses first appear — the order
 * the catalog offers them, so the flyout matches the connection card's pair rows.
 */
export const harnessSections = (row: PickerConnectionRow): ProviderSection[] => {
    const sections: ProviderSection[] = []
    const byHarness = new Map<string, ProviderSection>()
    // A model offered by two of this connection's harnesses is one search result twice over.
    // Counted by DISPLAY NAME, not by id: harnesses spell the same model differently
    // (`anthropic/claude-fable-5` vs `claude-fable-5`), and it is the name the two rows share.
    const timesOffered = new Map<string, number>()
    for (const model of row.models) {
        const {name} = splitCuratedLabel(model.label)
        timesOffered.set(name, (timesOffered.get(name) ?? 0) + 1)
    }

    for (const model of row.models) {
        let section = byHarness.get(model.harness)
        if (!section) {
            section = {
                key: model.harness,
                label: model.harnessLabel,
                iconKey: model.harness,
                options: [],
            }
            byHarness.set(model.harness, section)
            sections.push(section)
        }
        const {name} = splitCuratedLabel(model.label)
        section.options.push(optionFor(row, model, (timesOffered.get(name) ?? 0) > 1))
    }

    return sections
}

/**
 * The agent picker's menu: one group per connection, its flyout split by harness.
 *
 * `options` stays the flat list of every pair — it is what search filters and what resolves the
 * selected row — while `sections` is what the flyout draws.
 */
export const buildPickerGroupsWithSections = (rows: PickerConnectionRow[]): ProviderGroup[] =>
    rows.map((row) => {
        const sections = harnessSections(row)
        return {
            key: row.key,
            label: row.name,
            iconKey: row.iconKey,
            ...(row.kind === "subscription"
                ? {tag: SUBSCRIPTION_TAG, tagTone: "olive" as const}
                : {}),
            sections,
            options: sections.flatMap((section) => section.options),
        }
    })
