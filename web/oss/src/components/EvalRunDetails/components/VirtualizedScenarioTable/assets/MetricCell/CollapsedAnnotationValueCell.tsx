import {memo, useMemo} from "react"

import {useCachedScenarioSteps} from "@/oss/components/EvalRunDetails/hooks/useCachedScenarioSteps"
import LabelValuePill from "@/oss/components/ui/LabelValuePill"
import {useOptionalRunId} from "@/oss/contexts/RunIdContext"

import {CellWrapper} from "../CellComponents"

import {CollapsedAnnotationValueCellProps} from "./types"

function buildCollapsedValues(data: any, keys: string[]) {
    const annotations: any[] = []

    if (Array.isArray(data?.annotationSteps) && data.annotationSteps.length) {
        annotations.push(...data.annotationSteps.map((st: any) => st.annotation).filter(Boolean))
    }
    if (data?.annotations?.length) {
        annotations.push(...data.annotations)
    }
    if (data?.annotation) {
        annotations.push(data.annotation)
    }

    // Deduplicate by span_id+trace_id to avoid duplicates if same ann appears in multiple arrays
    const unique = new Map<string, any>()
    annotations.forEach((ann) => {
        if (!ann) return
        const key = `${ann.trace_id || ""}_${ann.span_id || Math.random()}`
        if (!unique.has(key)) unique.set(key, ann)
    })

    const out: Record<string, any> = {}
    keys.forEach((fieldPath) => {
        for (const ann of unique.values()) {
            let val = fieldPath
                .split(".")
                .reduce((acc: any, k: string) => (acc ? acc[k] : undefined), ann)

            if (val === undefined && fieldPath.startsWith("data.outputs.")) {
                const suffix = fieldPath.slice("data.outputs.".length)
                val = ann?.data?.outputs?.metrics?.[suffix] ?? ann?.data?.outputs?.extra?.[suffix]
            }
            if (val !== undefined) {
                out[fieldPath] = val
                break // stop at first found value
            }
        }
    })
    return out
}

const CollapsedAnnotationValueCell = memo<CollapsedAnnotationValueCellProps>(
    ({scenarioId, runId, childrenDefs}) => {
        const contextRunId = useOptionalRunId()
        const effectiveRunId = runId ?? contextRunId ?? null

        const keyPaths = useMemo(
            () => childrenDefs.map((c) => c.path || c.dataIndex || c.key) as string[],
            [childrenDefs],
        )

        if (!scenarioId || !effectiveRunId) {
            return (
                <CellWrapper>
                    <span className="text-gray-500">–</span>
                </CellWrapper>
            )
        }

        const {data: scenarioSteps} = useCachedScenarioSteps(effectiveRunId, scenarioId)

        const collapsedValues = useMemo(() => {
            if (!scenarioSteps) return {}
            return buildCollapsedValues(scenarioSteps, keyPaths)
        }, [scenarioSteps, keyPaths])

        if (!Object.keys(collapsedValues).length) {
            return (
                <CellWrapper>
                    <span className="text-gray-500">–</span>
                </CellWrapper>
            )
        }

        return (
            <CellWrapper>
                <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                    {Object.entries(collapsedValues).map(([name, val]) => (
                        <LabelValuePill
                            key={name}
                            label={name.split(".").pop() || name}
                            value={String(val)}
                            className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                        />
                    ))}
                </div>
            </CellWrapper>
        )
    },
)

export default CollapsedAnnotationValueCell
