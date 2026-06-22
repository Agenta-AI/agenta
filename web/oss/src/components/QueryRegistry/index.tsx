import {useCallback, useMemo, useState} from "react"

import {
    archiveQueryRevision,
    archiveSimpleQuery,
    createSimpleQuery,
    invalidateQueryCache,
    unarchiveQueryRevision,
    unarchiveSimpleQuery,
    type SimpleQueryCreate,
} from "@agenta/entities/query"
import {projectIdAtom} from "@agenta/shared/state"
import {PageLayout} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {TableEmptyState} from "@agenta/ui/components/presentational"
import {PlusOutlined} from "@ant-design/icons"
import {ArrowLeft, Tray} from "@phosphor-icons/react"
import {Button, Input, Space, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import type {EvalStepSlot} from "@/oss/components/pages/evaluations/NewEvaluation/evalSteps/types"
import useURL from "@/oss/hooks/useURL"

import QueryRegistryDrawer from "./Drawer/QueryRegistryDrawer"
import {querySearchTermAtom, queryRegistryActiveRowAtom} from "./store/queryRegistryFilterAtoms"
import type {QueryRegistryStatus} from "./store/queryRegistryFilterAtoms"
import type {QueryRegistryRow} from "./store/queryRegistryStore"
import {invalidateQueryRegistryStore} from "./store/queryRegistryStore"
import type {QueryColumnActions} from "./Table/assets/queryRegistryColumns"
import QueryRegistryTable from "./Table/QueryRegistryTable"

const {Text} = Typography

const NewEvaluationModal = dynamic(
    () => import("@/oss/components/pages/evaluations/NewEvaluation"),
    {ssr: false},
)

const EMPTY_CREATE_ROW: QueryRegistryRow = {
    key: "new",
    queryId: "",
    variantId: null,
    revisionId: null,
    name: "",
    slug: null,
    filtering: null,
    windowing: null,
    createdAt: null,
    createdById: null,
}

interface QueryRegistryProps {
    /** Active vs archived view — driven by the route (`/queries` vs `/queries/archived`). */
    mode?: QueryRegistryStatus
}

/**
 * Project-scoped Query Registry — lists saved trace-filter queries (SimpleQuery
 * rows with head-revision data inlined). Row click / "New query" open the manage
 * drawer via the active-row atom; duplicate and archive are wired here. Archive
 * uses a generic confirm because the backend exposes no reverse-reference lookup
 * (design decision D6). The archive lives at its own route (`/queries/archived`),
 * reached via the "Archived" header button — mirroring the Evaluators page.
 */
const QueryRegistry = ({mode = "active"}: QueryRegistryProps) => {
    const projectId = useAtomValue(projectIdAtom)
    const setSearchTerm = useSetAtom(querySearchTermAtom)
    const setActiveRow = useSetAtom(queryRegistryActiveRowAtom)
    const router = useRouter()
    const {projectURL} = useURL()
    const [search, setSearch] = useState("")
    const [archiveTarget, setArchiveTarget] = useState<QueryRegistryRow | null>(null)
    const [archiving, setArchiving] = useState(false)
    const [runEvalQuery, setRunEvalQuery] = useState<{
        queryId: string
        name?: string
    } | null>(null)

    const isArchived = mode === "archived"

    const handleSearch = useCallback(
        (value: string) => {
            setSearch(value)
            setSearchTerm(value)
        },
        [setSearchTerm],
    )

    const refresh = useCallback(() => {
        invalidateQueryRegistryStore()
        invalidateQueryCache()
    }, [])

    const openDrawer = useCallback(
        (record: QueryRegistryRow) => {
            setActiveRow(record)
        },
        [setActiveRow],
    )

    const handleNewQuery = useCallback(() => {
        setActiveRow(EMPTY_CREATE_ROW)
    }, [setActiveRow])

    const handleDuplicate = useCallback(
        async (record: QueryRegistryRow) => {
            if (!projectId) return
            try {
                await createSimpleQuery({
                    projectId,
                    query: {
                        name: `Copy of ${record.name}`,
                        ...(record.filtering
                            ? {data: {filtering: record.filtering} as SimpleQueryCreate["data"]}
                            : {}),
                    },
                })
                message.success("Query duplicated")
                refresh()
            } catch {
                message.error("Could not duplicate query")
            }
        },
        [projectId, refresh],
    )

    const handleArchive = useCallback((record: QueryRegistryRow) => {
        setArchiveTarget(record)
    }, [])

    const handleRunAutoEval = useCallback((record: QueryRegistryRow) => {
        setRunEvalQuery({
            queryId: record.queryId,
            name: record.name || undefined,
        })
    }, [])

    const archiveTargetIsRevision = Boolean(archiveTarget?.__isRevisionChild)

    const confirmArchive = useCallback(async () => {
        if (!projectId || !archiveTarget) return
        const isRevision = Boolean(archiveTarget.__isRevisionChild)
        setArchiving(true)
        try {
            if (isRevision && archiveTarget.revisionId) {
                // Revision row → archive just that version.
                await archiveQueryRevision({projectId, revisionId: archiveTarget.revisionId})
                message.success("Version archived")
            } else {
                // Parent row → archive the whole query.
                await archiveSimpleQuery({projectId, queryId: archiveTarget.queryId})
                message.success("Query archived")
            }
            setArchiveTarget(null)
            refresh()
        } catch {
            message.error(isRevision ? "Could not archive version" : "Could not archive query")
        } finally {
            setArchiving(false)
        }
    }, [projectId, archiveTarget, refresh])

    const handleRestore = useCallback(
        async (record: QueryRegistryRow) => {
            if (!projectId) return
            const isRevision = Boolean(record.__isArchivedRevision)
            try {
                if (isRevision && record.revisionId) {
                    await unarchiveQueryRevision({projectId, revisionId: record.revisionId})
                    message.success("Version restored")
                } else {
                    await unarchiveSimpleQuery({projectId, queryId: record.queryId})
                    message.success("Query restored")
                }
                refresh()
            } catch {
                message.error(isRevision ? "Could not restore version" : "Could not restore query")
            }
        },
        [projectId, refresh],
    )

    const actions: QueryColumnActions = useMemo(
        () => ({
            handleOpen: openDrawer,
            handleEdit: openDrawer,
            handleDuplicate,
            handleRunAutoEval,
            handleArchive,
            handleRestore,
        }),
        [openDrawer, handleDuplicate, handleRunAutoEval, handleArchive, handleRestore],
    )

    const runEvaluationSteps = useMemo<EvalStepSlot[]>(
        () =>
            runEvalQuery
                ? [
                      {
                          kind: "query",
                          required: true,
                          preset: {
                              queryId: runEvalQuery.queryId,
                              name: runEvalQuery.name,
                          },
                      },
                      {kind: "evaluator", required: true},
                      {kind: "advanced", required: true},
                  ]
                : [],
        [runEvalQuery],
    )

    const closeRunEvaluationModal = useCallback(() => setRunEvalQuery(null), [])

    // Archived view: swap the title for a back-arrow + "Archived Queries", exactly
    // like the Evaluators archived route.
    const title = isArchived ? (
        <span className="inline-flex items-center gap-2">
            <Button
                type="text"
                size="small"
                icon={<ArrowLeft size={16} />}
                onClick={() => router.push(`${projectURL}/queries`)}
                className="!px-1"
                aria-label="Back to queries"
            />
            <span>Archived Queries</span>
        </span>
    ) : (
        "Queries"
    )

    const filters = (
        <Input.Search
            placeholder="Search queries"
            allowClear
            className="w-[240px]"
            value={search}
            onChange={(event) => handleSearch(event.target.value)}
        />
    )

    // Active view shows [Archived ▸ route, New query]; the archived view has no
    // primary actions (the back-arrow title is the only nav).
    const primaryActions = isArchived ? null : (
        <Space>
            <Button
                type="text"
                icon={<Tray size={14} />}
                onClick={() => router.push(`${projectURL}/queries/archived`)}
            >
                Archived
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleNewQuery}>
                New query
            </Button>
        </Space>
    )

    const emptyState = isArchived ? (
        <TableEmptyState
            message="No archived queries"
            description="Queries you archive show up here and can be restored."
        />
    ) : (
        <TableEmptyState
            message="No saved queries yet"
            description="Queries are saved trace filters used by live evaluations. Create one to reuse a filter."
            action={
                <Button type="primary" icon={<PlusOutlined />} onClick={handleNewQuery}>
                    New query
                </Button>
            }
        />
    )

    return (
        <PageLayout title={title} className="grow min-h-0">
            <QueryRegistryTable
                actions={actions}
                // Editing an archived query is meaningless — only the active view
                // opens the manage drawer on row click.
                onRowClick={isArchived ? undefined : openDrawer}
                searchDeps={[search]}
                filters={filters}
                primaryActions={primaryActions}
                emptyState={emptyState}
                mode={mode}
            />
            <QueryRegistryDrawer />
            <NewEvaluationModal
                open={runEvalQuery !== null}
                onCancel={closeRunEvaluationModal}
                onSuccess={closeRunEvaluationModal}
                evaluationType="auto"
                preview={false}
                liveCompatibleEvaluatorsOnly
                steps={runEvaluationSteps}
            />
            <EnhancedModal
                centered
                width={480}
                open={archiveTarget !== null}
                title={
                    archiveTargetIsRevision
                        ? `Archive version v${archiveTarget?.version ?? ""}?`
                        : "Archive this query?"
                }
                okText="Archive"
                cancelText="Cancel"
                onOk={confirmArchive}
                onCancel={() => setArchiveTarget(null)}
                okButtonProps={{danger: true, loading: archiving}}
            >
                <Text type="secondary">
                    {archiveTargetIsRevision
                        ? "This removes the version from the query's history. It can be restored later."
                        : "This query may be in use by a live evaluation. Archived queries can be restored later."}
                </Text>
            </EnhancedModal>
        </PageLayout>
    )
}

export default QueryRegistry
