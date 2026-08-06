import {useMemo, useState} from "react"
import type {ComponentType} from "react"

import {Database, Gavel, SquaresFour, type IconProps} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {runInvocationRefsAtomFamily, runTestsetIdsAtomFamily} from "../../../../atoms/runDerived"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../../../atoms/table/evaluators"

import {CountBadge, V2Card} from "./SectionPrimitives"

interface NavItem {
    key: string
    label: string
    Icon: ComponentType<IconProps>
    count: number
}

/**
 * Rail nav: anchors that scroll to the Test set / Application / Evaluators
 * section cards. Hidden below the narrow container breakpoint (handled by the
 * parent via container-query classes).
 */
const SectionNavCard = ({runId, anchorSuffix}: {runId: string; anchorSuffix?: string}) => {
    const testsetIds = useAtomValue(useMemo(() => runTestsetIdsAtomFamily(runId), [runId]))
    const invocationRefs = useAtomValue(useMemo(() => runInvocationRefsAtomFamily(runId), [runId]))
    const evaluatorsQuery = useAtomValue(
        useMemo(() => evaluationEvaluatorsByRunQueryAtomFamily(runId), [runId]),
    )
    const [activeKey, setActiveKey] = useState<string | null>(null)

    const rawRefs = invocationRefs?.rawRefs ?? {}
    const evaluatorCount = Array.isArray(evaluatorsQuery.data) ? evaluatorsQuery.data.length : 0

    const items: NavItem[] = [
        {key: "testsets", label: "Test set", Icon: Database, count: testsetIds.length},
        {
            key: "invocation",
            label: "Application",
            Icon: SquaresFour,
            count: Object.keys(rawRefs).length ? 1 : 0,
        },
        {key: "evaluators", label: "Evaluators", Icon: Gavel, count: evaluatorCount},
    ].filter((item) => item.count > 0)

    if (!items.length) return null

    const effectiveActiveKey = activeKey ?? items[0].key

    return (
        <V2Card className="gap-0.5 p-2">
            {items.map(({key, label, Icon, count}) => (
                <button
                    key={key}
                    type="button"
                    aria-current={effectiveActiveKey === key ? "location" : undefined}
                    className={
                        "flex cursor-pointer items-center gap-2 rounded-md border-0 px-2.5 py-1.5 text-left text-[13px] " +
                        (effectiveActiveKey === key
                            ? "bg-zinc-1 font-medium text-colorText"
                            : "bg-transparent text-colorTextSecondary hover:bg-colorFillSecondary hover:text-colorText")
                    }
                    onClick={() => {
                        setActiveKey(key)
                        document
                            .getElementById(`config-section-${key}${anchorSuffix ?? ""}`)
                            ?.scrollIntoView({behavior: "smooth", block: "start"})
                    }}
                >
                    <Icon size={13} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <CountBadge>{count}</CountBadge>
                </button>
            ))}
        </V2Card>
    )
}

export default SectionNavCard
