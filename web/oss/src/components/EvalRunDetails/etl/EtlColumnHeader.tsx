/**
 * EtlColumnHeader
 *
 * Renders the nested-header label for a column group. The default
 * `computeColumnGroup` resolver falls back to `Testset <slug>` /
 * `Application <slug>` because it doesn't fetch the entity itself.
 *
 * This header is that override — same pattern production's
 * `StepGroupHeader` uses: subscribe to the entity reference atom by ID
 * and surface the entity's name when available, fall back to the slug
 * otherwise. Evaluator + metrics + other groups already carry
 * `slugToTitle`-rendered labels, so no entity lookup is needed.
 */

import {useMemo} from "react"

import type {ColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {Tooltip} from "antd"
import {atom, useAtomValue} from "jotai"

import {
    applicationReferenceQueryAtomFamily,
    testsetReferenceQueryAtomFamily,
} from "../atoms/references"

const emptyAtom = atom<{data: {name?: string; slug?: string} | null} | null>(null)

interface EtlColumnHeaderProps {
    group: ColumnGroup
}

const pickName = (entity: unknown): string | null => {
    if (!entity || typeof entity !== "object") return null
    const name = (entity as {name?: unknown}).name
    return typeof name === "string" && name.length > 0 ? name : null
}

const EtlColumnHeader = ({group}: EtlColumnHeaderProps) => {
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

    const label = useMemo(() => {
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
        <Tooltip title={label} placement="top">
            <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left">
                {label}
            </span>
        </Tooltip>
    )
}

export default EtlColumnHeader
