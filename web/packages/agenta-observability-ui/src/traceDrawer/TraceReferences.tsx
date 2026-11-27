import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import type {TraceSpanNode} from "@agenta/observability"
import {useEvaluatorNavigation} from "@agenta/observability/traceDrawer"

import {mergeReferenceChips, type TraceReference} from "../references/mergeReferenceChips"
import {ReferenceChipList} from "../references/ReferenceChipList"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null)

/**
 * The references of one span, as stored on the span: the `references` list (each with its key in
 * `attributes.key`), else the `ag.references` map. Only the span itself: the references of its
 * annotations (one evaluator each) and of its children are not the span's.
 */
export function spanReferences(span: TraceSpanNode | null | undefined): TraceReference[] {
    if (!span) return []
    const stored = (span as {references?: unknown}).references
    if (Array.isArray(stored) && stored.length > 0) {
        return stored.filter(isRecord).map((reference) => ({
            key: isRecord(reference.attributes) ? text(reference.attributes.key) : null,
            id: text(reference.id),
            slug: text(reference.slug),
            version: (reference.version as string | number | null | undefined) ?? null,
        }))
    }
    const attributes = (span as {attributes?: unknown}).attributes
    const ag = isRecord(attributes) && isRecord(attributes.ag) ? attributes.ag : null
    if (!ag || !isRecord(ag.references)) return []
    return Object.entries(ag.references)
        .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
        .map(([key, reference]) => ({
            key,
            id: text(reference.id),
            slug: text(reference.slug),
            version: (reference.version as string | number | null | undefined) ?? null,
        }))
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
