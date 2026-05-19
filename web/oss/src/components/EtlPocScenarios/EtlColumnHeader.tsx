/**
 * EtlColumnHeader
 *
 * Renders nicer-than-slug labels for a column group's header. The
 * default `computeColumnGroup` resolver in the entities package falls
 * back to `Testset <slug>` / `Application <slug>` because it doesn't
 * fetch the entity itself (per the comment at resolveMappings.ts:405:
 * "Renderers with access to the testset entity should override the
 * label").
 *
 * This header is exactly that override — same pattern production's
 * `StepGroupHeader` uses, just minimal: subscribe to the entity
 * reference atom by ID and surface the entity's name when available,
 * fall back to the slug otherwise.
 *
 * One header instance per column header — header re-renders are cheap
 * because the reference atoms are cached per ID across all callers.
 */

import {useMemo} from "react"

import type {ColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {atom, useAtomValue} from "jotai"

import {
    applicationReferenceQueryAtomFamily,
    testsetReferenceQueryAtomFamily,
} from "@/oss/components/EvalRunDetails/atoms/references"

const emptyAtom = atom<{data: {name?: string; slug?: string} | null} | null>(null)

interface EtlColumnHeaderProps {
    group: ColumnGroup
    columnName: string
}

const pickName = (entity: unknown): string | null => {
    if (!entity || typeof entity !== "object") return null
    const name = (entity as {name?: unknown}).name
    return typeof name === "string" && name.length > 0 ? name : null
}

const EtlColumnHeader = ({group, columnName}: EtlColumnHeaderProps) => {
    // Map the group → the reference atom that owns its display name.
    // Atom family params are stable strings (the entity ID), so each call
    // returns the same atom — no spurious re-renders.
    const refAtom = useMemo(() => {
        if (group.kind === "testset") {
            const id = (group.refs?.testset as {id?: string} | undefined)?.id
            return id ? testsetReferenceQueryAtomFamily(id) : emptyAtom
        }
        if (group.kind === "application") {
            const id = (group.refs?.application as {id?: string} | undefined)?.id
            return id ? applicationReferenceQueryAtomFamily(id) : emptyAtom
        }
        // Evaluator + metrics groups already use `slugToTitle`-rendered
        // labels in computeColumnGroup ("Exact Match", "Llm As A Judge",
        // "Metrics") — no entity lookup adds value.
        return emptyAtom
    }, [group])

    const ref = useAtomValue(refAtom) as {data?: unknown} | null
    const entity = ref?.data ?? null
    const name = pickName(entity)

    const groupLabel = useMemo(() => {
        switch (group.kind) {
            case "testset":
                return name ? `Testset ${name}` : group.label
            case "application":
                return name ? `Application ${name}` : group.label
            default:
                return group.label
        }
    }, [group.kind, group.label, name])

    return (
        <span>
            <span className="font-semibold">{groupLabel}</span>
            <span className="text-zinc-400"> · </span>
            <span>{columnName}</span>
        </span>
    )
}

export default EtlColumnHeader
