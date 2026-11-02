import type {FieldConfig} from "./fieldAdapter"
import type {FilterItem} from "./types"

/**
 * Display-only projection that keeps the permanent references row's label in
 * sync with the dialog's local `trace_type` selection.
 *
 * After Apply the atom regenerates the references row's `attributes.key` from
 * the effective trace_type (annotation → evaluator, invocation → application).
 * While the user is still editing, the row sits in local state, so changing
 * trace_type would otherwise have no visible effect on the references label.
 *
 * Only ever rewrites label/field metadata — never `value` — and preserves array
 * length and per-index order, because the dialog mutates the underlying state
 * by index.
 *
 * Skipped for non-evaluator workflows: the references row is always pinned to
 * `application` there, so flipping the label would be misleading.
 */
export const reconcileFilterRows = (
    rows: FilterItem[],
    workflowKind: string | null | undefined,
    filterFieldMap: Map<string, FieldConfig>,
): FilterItem[] => {
    if (workflowKind !== "evaluator") return rows

    const tt = rows.find((r) => r.selectedField === "trace_type" || r.field === "trace_type")
    // Mirror the atom's trace_type intent resolution (controls.ts):
    // honour `is_not`/`not_in` against the 2-value enum by flipping.
    const op = tt?.operator
    const rawValue = Array.isArray(tt?.value) ? tt?.value[0] : tt?.value
    const isAffirm = op === "is" || op === "in"
    const isNeg = op === "is_not" || op === "not_in"
    const normalize = (x: unknown): "annotation" | "invocation" | null =>
        x === "annotation" ? "annotation" : x === "invocation" ? "invocation" : null
    const flip = (x: unknown): "annotation" | "invocation" | null =>
        x === "annotation" ? "invocation" : x === "invocation" ? "annotation" : null
    let effective: "annotation" | "invocation" | null = null
    if (tt && isAffirm) effective = normalize(rawValue)
    else if (tt && isNeg) effective = flip(rawValue)

    // When trace_type is absent, fall through to "no opinion" — keep whatever
    // the row currently shows (which came from the atom's default).
    if (!effective) return rows

    const targetCategory = effective === "invocation" ? "application" : "evaluator"

    return rows.map((row) => {
        if (!row.isPermanent) return row
        const optionKey = row.selectedField || row.field
        if (!optionKey) return row
        const fc = filterFieldMap.get(optionKey)
        if (!fc?.referenceCategory) return row
        if (fc.referenceCategory !== "application" && fc.referenceCategory !== "evaluator") {
            return row
        }
        if (fc.referenceCategory === targetCategory) return row
        // Corresponding FieldConfig for the target category, same referenceProperty.
        let target: FieldConfig | undefined
        for (const candidate of filterFieldMap.values()) {
            if (candidate.referenceCategory !== targetCategory) continue
            if (candidate.referenceProperty !== fc.referenceProperty) continue
            target = candidate
            break
        }
        if (!target) return row
        return {
            ...row,
            field: target.optionKey,
            selectedField: target.optionKey,
            selectedLabel: target.label,
            baseField: target.baseField,
        }
    })
}
