/**
 * EtlColumnHeader
 *
 * Renders the nested-header label for a column group. The default
 * `computeColumnGroup` resolver falls back to `Testset <slug>` /
 * `Application <slug>` / `slugToTitle(evaluatorSlug)` because it can't
 * fetch the entity itself.
 *
 * This header is that override — same pattern production's
 * `StepGroupHeader` uses: subscribe to the entity reference atom by ID
 * and surface the entity's name when available, fall back to the slug
 * otherwise. Applies to testset, application AND evaluator groups so
 * the table header text never reads as a raw slug (e.g.
 * "with-reasoning-jifn" / "With Reasoning Jifn") when a real evaluator
 * name (e.g. "With Reasoning") is known.
 */

import {useMemo} from "react"

import type {ColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {Tooltip} from "antd"
import {atom, useAtomValue} from "jotai"

import {
    applicationReferenceQueryAtomFamily,
    testsetReferenceQueryAtomFamily,
} from "../atoms/references"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../atoms/table/evaluators"

const emptyAtom = atom<{data: {name?: string; slug?: string} | null} | null>(null)
const emptyEvaluatorsAtom = atom({data: [], isPending: false, isFetching: false, isError: false})

interface EtlColumnHeaderProps {
    group: ColumnGroup
    /**
     * Run id used to look up the run's evaluator definitions. When the
     * group is an evaluator the header reads `name` off the matching
     * definition (matched by id, then slug) instead of the slug-derived
     * fallback label.
     */
    runId: string | null
}

const pickName = (entity: unknown): string | null => {
    if (!entity || typeof entity !== "object") return null
    const name = (entity as {name?: unknown}).name
    return typeof name === "string" && name.length > 0 ? name : null
}

const EtlColumnHeader = ({group, runId}: EtlColumnHeaderProps) => {
    const refAtom = useMemo(() => {
        if (group.kind === "testset") {
            const id = (group.refs?.testset as {id?: string} | undefined)?.id
            return id ? testsetReferenceQueryAtomFamily(id) : emptyAtom
        }
        if (group.kind === "application") {
            const id = (group.refs?.application as {id?: string} | undefined)?.id
            return id ? applicationReferenceQueryAtomFamily(id) : emptyAtom
        }
        return emptyAtom
    }, [group])

    const ref = useAtomValue(refAtom) as {data?: unknown} | null
    const name = pickName(ref?.data ?? null)

    // Evaluator lookup — match by id first, then slug. The atom is a
    // run-level query that the table already subscribes to elsewhere, so
    // this is just an additional cheap subscriber.
    const evaluatorsAtom = useMemo(() => {
        if (group.kind !== "evaluator" || !runId) return emptyEvaluatorsAtom
        return evaluationEvaluatorsByRunQueryAtomFamily(runId)
    }, [group.kind, runId])
    const evaluatorsQuery = useAtomValue(evaluatorsAtom) as {
        data: {id?: string; slug?: string; name?: string}[]
    }
    const evaluatorName = useMemo(() => {
        if (group.kind !== "evaluator") return null
        const refs = group.refs as
            | {evaluator?: {id?: string; slug?: string}; evaluator_revision?: {slug?: string}}
            | undefined
            | null
        const evaluatorId = refs?.evaluator?.id ?? null
        const evaluatorSlug = refs?.evaluator?.slug ?? refs?.evaluator_revision?.slug ?? null
        const match = (evaluatorsQuery.data ?? []).find((e) => {
            if (evaluatorId && e.id === evaluatorId) return true
            if (evaluatorSlug && e.slug === evaluatorSlug) return true
            return false
        })
        return pickName(match)
    }, [group, evaluatorsQuery.data])

    const label = useMemo(() => {
        // Each non-"other" group is prefixed with its kind ("Testset: …",
        // "Application: …", "Evaluator: …") so the header reads as a
        // self-describing pair. Falls back to the slug (or the existing
        // slug-titled label for evaluator) when the entity name hasn't
        // loaded — we use `group.slug` directly here, not `group.label`,
        // because the default labels already embed the kind word and
        // would double-prefix (e.g. "Testset: Testset completion-tst").
        switch (group.kind) {
            case "testset":
                return `Testset: ${name ?? group.slug ?? "—"}`
            case "application":
                return `Application: ${name ?? group.slug ?? "—"}`
            case "evaluator":
                return `Evaluator: ${evaluatorName ?? group.label}`
            default:
                return group.label
        }
    }, [group.kind, group.label, group.slug, name, evaluatorName])

    return (
        <Tooltip title={label} placement="top">
            <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left">
                {label}
            </span>
        </Tooltip>
    )
}

export default EtlColumnHeader
