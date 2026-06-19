import {useEffect, useMemo} from "react"

import {queryHeadQueryAtomFamily} from "@agenta/entities/query"
import {Alert, Skeleton, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import QueryTracePreview from "@/oss/components/Traces/QueryTracePreview"

import type {EvalStepSectionProps, QueryStepValue} from "../evalSteps/types"

const countConditions = (filtering: unknown): number => {
    if (!filtering || typeof filtering !== "object") return 0
    const node = filtering as {field?: unknown; conditions?: unknown[]}
    if (!Array.isArray(node.conditions)) return typeof node.field === "string" ? 1 : 0
    return node.conditions.reduce<number>(
        (count, condition) => count + countConditions(condition),
        0,
    )
}

const QuerySourceSection = ({value, context}: EvalStepSectionProps<QueryStepValue>) => {
    const queryAtom = useMemo(() => queryHeadQueryAtomFamily(value.queryId), [value.queryId])
    const {data: revision, isPending, isError} = useAtomValue(queryAtom)
    const name = revision?.name ?? revision?.query_slug ?? value.queryId
    const filtering = revision?.data?.filtering
    const conditionCount = countConditions(filtering)

    useEffect(() => {
        if (!revision?.id) return
        context.setStepValue("query", (current) =>
            current.name === name ? current : {...current, name},
        )
    }, [context.setStepValue, name, revision?.id])

    if (!value.queryId) {
        return <Typography.Text type="secondary">No query selected</Typography.Text>
    }
    if (!context.projectId || isError || (!isPending && !revision?.id)) {
        return <Alert type="error" showIcon message="Couldn't load the selected query" />
    }
    if (isPending || !revision) {
        return <Skeleton active paragraph={{rows: 5}} />
    }

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-center gap-2">
                <Typography.Text strong>{name}</Typography.Text>
                <Tag className="m-0">
                    {conditionCount} filter condition
                    {conditionCount === 1 ? "" : "s"}
                </Tag>
            </div>
            <div className="min-h-0 flex-1">
                <QueryTracePreview projectId={context.projectId} filtering={filtering} />
            </div>
        </div>
    )
}

export default QuerySourceSection
