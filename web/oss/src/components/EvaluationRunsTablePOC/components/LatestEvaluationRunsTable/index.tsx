import {useEffect, useMemo, useState} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import Link from "next/link"
import {useRouter} from "next/router"

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
    /** When false, removes default padding/border/shadow from the table container */
    withContainerStyles?: boolean
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
    withContainerStyles = true,
}: LatestEvaluationRunsTableProps) => {
    const router = useRouter()
    const [isActive, setIsActive] = useState(false)

    useEffect(() => {
        setIsActive(true)
    }, [])

    const headerTitle = useMemo(
        () =>
            title ? (
                <div className="flex items-center gap-3 [&_>_h1.ant-typography]:text-xs">
                    <Typography.Title level={3} className="!m-0">
                        {title}
                    </Typography.Title>
                </div>
            ) : null,
        [title],
    )

    const resolvedViewAllHref = useMemo(() => {
        if (viewAllHref) return viewAllHref
        const workspaceId = router.query.workspace_id
        const projectId = router.query.project_id
        const appIdParam = router.query.app_id ?? appId
        if (!workspaceId || !projectId || !appIdParam) return null
        const basePath = `/w/${workspaceId}/p/${projectId}/apps/${appIdParam}/evaluations`
        return `${basePath}?kind=${evaluationKind}`
    }, [appId, evaluationKind, router.query, viewAllHref])

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
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
                    hideOnboardingVideos={true}
                    className={clsx(
                        withContainerStyles &&
                            "border border-gray-100 rounded-lg px-2 py-4 bg-white shadow-sm",
                    )}
                />
            </EvaluationRunsTableStoreProvider>

            {resolvedViewAllHref ? (
                <div className="flex justify-end">
                    <Link href={resolvedViewAllHref} prefetch className="underline">
                        {title} →
                    </Link>
                </div>
            ) : null}
        </div>
    )
}

export default LatestEvaluationRunsTable
