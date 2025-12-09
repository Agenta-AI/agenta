import {useEffect, useMemo, useState} from "react"

import {Button, Typography} from "antd"
import clsx from "clsx"
import Link from "next/link"

import EvaluationRunsTableStoreProvider from "../../providers/EvaluationRunsTableStoreProvider"
import type {EvaluationRunKind} from "../../types"
import EvaluationRunsTablePOC from "../EvaluationRunsTable"

interface LatestEvaluationRunsTableProps {
    evaluationKind: EvaluationRunKind
    appId?: string | null
    projectIdOverride?: string | null
    includePreview?: boolean
    limit?: number
    className?: string
    title?: string
    viewAllHref?: string
    /** When true, scopes the table to the provided appId */
    appScoped?: boolean
}

const LatestEvaluationRunsTable = ({
    evaluationKind,
    appId = null,
    projectIdOverride = null,
    includePreview = true,
    limit = 5,
    className,
    title,
    viewAllHref,
    appScoped = false,
}: LatestEvaluationRunsTableProps) => {
    const [isActive, setIsActive] = useState(false)

    useEffect(() => {
        setIsActive(true)
    }, [])

    const headerTitle = useMemo(() => {
        if (!title) return null
        return (
            <div className="flex items-center gap-3 [&_>_h1.ant-typography]:text-xs">
                <Typography.Title>{title}</Typography.Title>
                {viewAllHref ? (
                    <Link href={viewAllHref} className="ml-2" prefetch>
                        <Button type="default">View all</Button>
                    </Link>
                ) : null}
            </div>
        )
    }, [title, viewAllHref])

    return (
        <div className={clsx("flex flex-col gap-3", className)}>
            <EvaluationRunsTableStoreProvider
                overrides={{
                    evaluationKind,
                    appId,
                    projectIdOverride,
                    includePreview,
                    ...(appScoped && {scope: "app" as const}),
                }}
                pageSize={limit}
            >
                <EvaluationRunsTablePOC
                    evaluationKind={evaluationKind}
                    appId={appId}
                    projectIdOverride={projectIdOverride}
                    includePreview={includePreview}
                    pageSize={limit}
                    manageContextOverrides={false}
                    active={isActive}
                    showFilters={false}
                    enableInfiniteScroll={false}
                    autoHeight={false}
                    headerTitle={headerTitle}
                    className="border border-gray-100 rounded-lg px-2 py-4 bg-white shadow-sm"
                />
            </EvaluationRunsTableStoreProvider>
        </div>
    )
}

export default LatestEvaluationRunsTable
