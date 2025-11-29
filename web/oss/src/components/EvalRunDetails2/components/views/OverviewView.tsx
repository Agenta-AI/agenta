import {memo, useMemo} from "react"

import {useAtomValue} from "jotai"

import {compareRunIdsAtom} from "../../atoms/compare"

import {AggregatedOverviewSection, BaseRunMetricsSection} from "./OverviewView/components"

interface OverviewViewProps {
    runId: string
}

/**
 * OverviewView keeps run-level data normalized. Each child section derives the
 * minimal pieces it needs via atoms/selectors instead of relying on a shared summary.
 */
const OverviewView = ({runId}: OverviewViewProps) => {
    const compareRunIds = useAtomValue(compareRunIdsAtom)

    const runIds = useMemo(() => {
        const unique = new Set<string>()
        const order: string[] = []
        const push = (id?: string | null) => {
            if (!id || unique.has(id)) return
            unique.add(id)
            order.push(id)
        }

        push(runId)
        compareRunIds.forEach((id) => push(id))

        return order
    }, [runId, compareRunIds])

    const baseRunId = runIds[0]
    const comparisonRunIds = useMemo(() => runIds.slice(1), [runIds])

    if (!runIds.length) {
        return null
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-zinc-1 px-3 pt-2">
            <div className="flex-1 overflow-y-auto">
                <div className="flex flex-col gap-6 pb-6">
                    <AggregatedOverviewSection runIds={runIds} />
                    {baseRunId ? (
                        <BaseRunMetricsSection
                            baseRunId={baseRunId}
                            comparisonRunIds={comparisonRunIds}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    )
}

export default memo(OverviewView)
