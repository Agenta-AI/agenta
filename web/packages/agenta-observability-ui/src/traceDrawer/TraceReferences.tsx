import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import type {TraceSpanNode} from "@agenta/observability"
import {useEvaluatorNavigation} from "@agenta/observability/traceDrawer"

import {mergeReferenceChips, type TraceReference} from "../references/mergeReferenceChips"
import {ReferenceChipList} from "../references/ReferenceChipList"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null)

const versionOf = (value: unknown): string | number | null =>
    typeof value === "string" || typeof value === "number" ? value : null

/**
 * The references of one span, as stored on the span: the `references` list (each with its key in
 * `attributes.key`) and the `ag.references` map. The response schema keeps only the id of a list
 * entry, so the map fills a missing slug or version by key (a slug-only reference keeps its
 * chip), and adds the keys the list lacks. Only the span itself: the references of its
 * annotations (one evaluator each) and of its children are not the span's.
 */
export function spanReferences(span: TraceSpanNode | null | undefined): TraceReference[] {
    if (!span) return []
    const attributes = (span as {attributes?: unknown}).attributes
    const ag = isRecord(attributes) && isRecord(attributes.ag) ? attributes.ag : null
    const map = new Map<string, Record<string, unknown>>(
        Object.entries(ag && isRecord(ag.references) ? ag.references : {}).filter(
            (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]),
        ),
    )
    const stored = (span as {references?: unknown}).references
    const list = (Array.isArray(stored) ? stored : []).filter(isRecord).map((reference) => {
        const key = isRecord(reference.attributes) ? text(reference.attributes.key) : null
        const fromMap = key ? map.get(key) : undefined
        return {
            key,
            id: text(reference.id) ?? text(fromMap?.id),
            slug: text(reference.slug) ?? text(fromMap?.slug),
            version: versionOf(reference.version) ?? versionOf(fromMap?.version),
        }
    })
    const listed = new Set(list.map((reference) => reference.key))
    const onlyInMap = [...map]
        .filter(([key]) => !listed.has(key))
        .map(([key, reference]) => ({
            key,
            id: text(reference.id),
            slug: text(reference.slug),
            version: versionOf(reference.version),
        }))
    return [...list, ...onlyInMap]
}

/**
 * The References section of the side panel: one chip per entity the span references
 * (`ReferenceChipList`). An evaluator chip links to the evaluator page the drawer knows. No
 * section without references.
 */
const TraceReferences = ({span}: {span: TraceSpanNode | null | undefined}) => {
    const t = useT(drawerCatalog)
    const {buildEvaluatorTarget} = useEvaluatorNavigation()
    const references = spanReferences(span)

    if (mergeReferenceChips(references).length === 0) return null

    return (
        <section className="flex flex-col gap-2" data-testid="trace-references">
            <h3 className="m-0 text-label">{t("observabilityUi.traceDrawer.references")}</h3>
            <ReferenceChipList
                references={references}
                hrefOf={(chip) =>
                    chip.kind === "evaluator"
                        ? buildEvaluatorTarget({
                              id: chip.entity?.id ?? undefined,
                              slug: chip.entity?.slug ?? undefined,
                          })?.href
                        : undefined
                }
            />
        </section>
    )
}

export default TraceReferences
