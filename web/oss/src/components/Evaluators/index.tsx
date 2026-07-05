import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {
    createEvaluatorFromTemplate,
    type EvaluatorCatalogTemplate,
    invalidateEvaluatorsListCache,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {workflowRevisionDrawerNavigationIdsAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {Button} from "@agenta/primitive-ui/components/button"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {PageLayout} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {PlusOutlined} from "@ant-design/icons"
import {ArrowLeft, ChartDonutIcon, ListChecksIcon, Tray} from "@phosphor-icons/react"
import {Input, Space} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import {appIdentifiersAtom, useQueryParamState} from "@/oss/state/appState"
import {openEvaluatorDrawerAtom} from "@/oss/state/evaluator/evaluatorDrawerStore"
import {getProjectValues} from "@/oss/state/project"
import {EVALUATOR_FULL_PAGE_NAV_ENABLED, recentEvaluatorIdAtom} from "@/oss/state/workflow"

import {DEFAULT_EVALUATOR_TAB, EVALUATOR_TABS} from "./assets/constants"
import type {EvaluatorCategory} from "./assets/types"
import DeleteEvaluatorsModal from "./components/DeleteEvaluatorsModal"
import EvaluatorTemplateDropdown from "./components/EvaluatorTemplateDropdown"
import {openHumanEvaluatorDrawerAtom} from "./Drawers/HumanEvaluatorDrawer/store"
import type {EvaluatorTableRow} from "./store/evaluatorsPaginatedStore"
import {
    getEvaluatorsTableState,
    invalidateEvaluatorManagementQueries,
} from "./store/evaluatorsPaginatedStore"
import EvaluatorsTable, {type EvaluatorsTableSelection} from "./Table/EvaluatorsTable"

const isValidEvaluatorTab = (value: string): value is EvaluatorCategory => {
    return EVALUATOR_TABS.some(({key}) => key === value)
}

const EVALUATOR_PAGE_SIZE = 50

interface EvaluatorsRegistryProps {
    scope?: "project" | "app"
    mode?: "active" | "archived"
}

const EvaluatorsRegistry = ({scope = "project", mode = "active"}: EvaluatorsRegistryProps) => {
    const isArchived = mode === "archived"
    const router = useRouter()
    const {projectURL} = useURL()
    const tableState = getEvaluatorsTableState(mode)

    const [activeTab, setActiveTab] = useAtom(tableState.categoryAtom)
    const [searchTerm, setSearchTerm] = useAtom(tableState.searchTermAtom)
    const [tabState, setTabState] = useQueryParam("tab", activeTab)
    const onboardingWidgetActivation = useAtomValue(onboardingWidgetActivationAtom)
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)

    const [, setQueryRevision] = useQueryParamState("revisionId")
    const openEvaluatorDrawer = useSetAtom(openEvaluatorDrawerAtom)
    const openHumanDrawer = useSetAtom(openHumanEvaluatorDrawerAtom)
    const setNavigationIds = useSetAtom(workflowRevisionDrawerNavigationIdsAtom)

    // Phase 5: full-page navigation for evaluator EDIT (drawer remains for
    // human + create + the per-row "Quick edit" action). Writes
    // recentEvaluatorIdAtom alongside the navigation push.
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    const setRecentEvaluatorId = useSetAtom(recentEvaluatorIdAtom)
    const navigateToEvaluatorPage = useCallback(
        (evaluatorId: string, options?: {revisionId?: string}) => {
            if (!workspaceId || !projectId || !evaluatorId) return false
            setRecentEvaluatorId(evaluatorId)
            // Pin the destination to a specific revision when provided.
            // Required for post-create navigation: without `?revisions=`, the
            // playground page defaults to the v0 (empty initial) revision
            // and the user's just-committed v1 — which holds the prompt /
            // schema — never gets selected. Row-click navigation can omit
            // this and let the playground fall back to "latest" naturally.
            const base = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
                projectId,
            )}/apps/${encodeURIComponent(evaluatorId)}/playground`
            const href = options?.revisionId
                ? `${base}?revisions=${encodeURIComponent(options.revisionId)}`
                : base
            void router.push(href)
            return true
        },
        [router, workspaceId, projectId, setRecentEvaluatorId],
    )

    const controllerParams = useMemo(
        () => ({
            scopeId: isArchived ? "archived-evaluators" : "evaluators",
            pageSize: EVALUATOR_PAGE_SIZE,
        }),
        [isArchived],
    )
    const evalTableState = useAtomValue(tableState.paginatedStore.selectors.state(controllerParams))
    const setSelectedKeys = useSetAtom(
        tableState.paginatedStore.selectors.selection(controllerParams),
    )

    useEffect(() => {
        if (isArchived) return

        const navIds = evalTableState.rows
            .map((row) => row.revisionId)
            .filter((id): id is string => Boolean(id))
        if (navIds.length > 0) {
            setNavigationIds(navIds)
        }
    }, [evalTableState.rows, isArchived, setNavigationIds])

    useEffect(() => {
        if (isArchived) return

        if (tabState && isValidEvaluatorTab(tabState)) {
            if (tabState !== activeTab) {
                setActiveTab(tabState)
            }
            return
        }

        const fallbackTab = isValidEvaluatorTab(activeTab) ? activeTab : DEFAULT_EVALUATOR_TAB

        if (activeTab !== fallbackTab) {
            setActiveTab(fallbackTab)
        }

        if (tabState !== fallbackTab) {
            setTabState(fallbackTab)
        }
    }, [activeTab, isArchived, setActiveTab, setTabState, tabState])

    useEffect(() => {
        if (!isArchived) return

        const archivedTab =
            tabState && isValidEvaluatorTab(tabState) ? tabState : DEFAULT_EVALUATOR_TAB
        if (activeTab !== archivedTab) {
            setActiveTab(archivedTab)
        }
    }, [activeTab, isArchived, setActiveTab, tabState])

    useEffect(() => {
        if (isArchived || onboardingWidgetActivation !== "create-evaluator") return

        setActiveTab("automatic")
        setTabState("automatic")
        setOnboardingWidgetActivation(null)
    }, [
        isArchived,
        onboardingWidgetActivation,
        setActiveTab,
        setOnboardingWidgetActivation,
        setTabState,
    ])

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
    const [deleteTargetRevisionIds, setDeleteTargetRevisionIds] = useState<string[]>([])

    const refetchAll = useCallback(() => {
        invalidateEvaluatorsListCache()
    }, [])

    const onTabChange = useCallback(
        (value: EvaluatorCategory) => {
            setActiveTab(value)
            if (!isArchived) {
                setTabState(value)
            }
        },
        [isArchived, setActiveTab, setTabState],
    )

    const openAutomaticEvaluator = useCallback(
        (record: EvaluatorTableRow) => {
            const revisionId = record.revisionId || record.workflowId
            if (!revisionId) return

            setQueryRevision(revisionId, {shallow: true})
        },
        [setQueryRevision],
    )

    const openHumanEvaluator = useCallback(
        (record: EvaluatorTableRow) => {
            openHumanDrawer({
                mode: "edit",
                workflowId: record.workflowId,
                revisionId: record.revisionId,
                onSuccess: () => refetchAll(),
            })
        },
        [openHumanDrawer, refetchAll],
    )

    const handleOpenHumanDrawer = useCallback(() => {
        openHumanDrawer({
            mode: "create",
            onSuccess: () => refetchAll(),
        })
    }, [openHumanDrawer, refetchAll])

    const handleSelectTemplate = useCallback(
        async (evaluator: EvaluatorCatalogTemplate) => {
            const templateKey = evaluator.key
            if (!templateKey) {
                message.error("Unable to open evaluator template")
                return
            }

            const localId = await createEvaluatorFromTemplate(templateKey)
            if (!localId) {
                message.error("Unable to create evaluator from template")
                return
            }

            openEvaluatorDrawer({
                entityId: localId,
                mode: "create",
                // The post-create routing (playground vs stay on /evaluators)
                // is owned by `useDrawerCreateCommitCallback` in the drawer
                // wrapper now — it reads the just-committed revision's URI /
                // flags from the API response and pushes the playground URL
                // *inside the wrapper effect*, matching what the app-create
                // path already does. Keeping the navigation closure here as
                // well would re-introduce the stale-closure / Fast-Refresh
                // race that produced "first attempt didn't redirect" reports.
                // We only refresh the list cache so the new evaluator appears
                // in the registry on the user's next visit.
                onWorkflowCreated: () => {
                    refetchAll()
                },
            })
        },
        [openEvaluatorDrawer, refetchAll],
    )

    const handleRowClick = useCallback(
        (record: EvaluatorTableRow) => {
            if (activeTab === "human") {
                // Human evaluators don't have a full-page playground; keep the
                // existing drawer-edit flow.
                openHumanEvaluator(record)
                return
            }

            // Archived evaluators stay in the drawer-only flow.
            if (isArchived) {
                openAutomaticEvaluator(record)
                return
            }

            // All non-archived automatic evaluators open in the full-page
            // playground. Earlier this was gated on classifier type
            // (`hasFullPagePlaygroundUX`) so declarative classifiers stayed in
            // the drawer-edit flow, but in practice that meant whole evaluator
            // types had no UI path into the per-evaluator pages (variants,
            // traces). Drawer stays available as a secondary affordance via
            // the row context menu's Configure action.
            //
            // Gated by `EVALUATOR_FULL_PAGE_NAV_ENABLED`: while the flag is
            // off, every row click resolves to the drawer.
            const shouldNavigateToFullPage = Boolean(
                EVALUATOR_FULL_PAGE_NAV_ENABLED && record.workflowId,
            )

            const navigated =
                shouldNavigateToFullPage && record.workflowId
                    ? navigateToEvaluatorPage(record.workflowId)
                    : false
            if (!navigated) {
                openAutomaticEvaluator(record)
            }
        },
        [
            activeTab,
            isArchived,
            navigateToEvaluatorPage,
            openAutomaticEvaluator,
            openHumanEvaluator,
        ],
    )

    const handleRestore = useCallback(async (record: EvaluatorTableRow) => {
        try {
            const {projectId} = getProjectValues()
            if (!projectId || !record.workflowId) return

            await workflowMolecule.lifecycle.unarchive(record.workflowId, {projectId})
            await invalidateEvaluatorManagementQueries()
            message.success("Evaluator restored")
        } catch (error) {
            message.error(extractApiErrorMessage(error))
        }
    }, [])

    const handleConfirmDelete = useCallback(async () => {
        if (!deleteTargetIds.length) return

        try {
            setIsDeleting(true)
            const {projectId} = getProjectValues()
            if (!projectId) return

            if (activeTab !== "human") {
                const canDelete = await checkIfResourceValidForDeletion({
                    resourceType: "evaluator_config",
                    resourceIds: deleteTargetIds,
                })
                if (!canDelete) return
            }

            // Capture the row keys of the archived workflows before the cache
            // invalidation removes them from the table data, so the selection
            // can be pruned regardless of which flow (bulk button or row menu)
            // triggered the archive.
            const archivedRowKeys = new Set(
                evalTableState.rows
                    .filter((row) => deleteTargetIds.includes(row.workflowId))
                    .map((row) => String(row.key)),
            )

            await Promise.all(
                deleteTargetIds.map((id) => workflowMolecule.lifecycle.archive(id, {projectId})),
            )
            setSelectedKeys((prev) => prev.filter((key) => !archivedRowKeys.has(String(key))))
            await invalidateEvaluatorManagementQueries()
            refetchAll()

            message.success(
                deleteTargetIds.length === 1
                    ? "Evaluator archived"
                    : `${deleteTargetIds.length} evaluators archived`,
            )
        } catch (error) {
            console.error(error)
            message.error("Failed to archive evaluators")
        } finally {
            setIsDeleting(false)
            setIsDeleteModalOpen(false)
            setDeleteTargetIds([])
            setDeleteTargetRevisionIds([])
        }
    }, [activeTab, deleteTargetIds, evalTableState.rows, refetchAll, setSelectedKeys])

    const columnActions = useMemo(
        () =>
            isArchived
                ? {
                      handleOpen: (record: EvaluatorTableRow) => {
                          if (activeTab === "human") {
                              openHumanEvaluator(record)
                              return
                          }

                          openAutomaticEvaluator(record)
                      },
                      handleRestore: (record: EvaluatorTableRow) => handleRestore(record),
                  }
                : {
                      handleConfigure: (record: EvaluatorTableRow) => {
                          openAutomaticEvaluator(record)
                      },
                      handleEdit: (record: EvaluatorTableRow) => {
                          openHumanEvaluator(record)
                      },
                      handleDelete: (record: EvaluatorTableRow) => {
                          if (!record.workflowId) return
                          setDeleteTargetIds([record.workflowId])
                          setDeleteTargetRevisionIds(record.revisionId ? [record.revisionId] : [])
                          setIsDeleteModalOpen(true)
                      },
                  },
        [activeTab, handleRestore, isArchived, openAutomaticEvaluator, openHumanEvaluator],
    )

    const activeTabLabel = useMemo(() => {
        return EVALUATOR_TABS.find((tab) => tab.key === activeTab)?.label || "Evaluators"
    }, [activeTab])

    const breadcrumbKey = scope === "project" ? "projectPage" : "appPage"

    useBreadcrumbsEffect(
        {
            breadcrumbs: {[breadcrumbKey]: {label: activeTabLabel}},
            type: "append",
            condition: !isArchived,
        },
        [activeTabLabel, breadcrumbKey, isArchived],
    )

    const evaluatorTabItems = useMemo(
        () =>
            EVALUATOR_TABS.map((tab) => ({
                key: tab.key,
                label: (
                    <span className="inline-flex items-center gap-2">
                        {tab.key === "automatic" ? <ChartDonutIcon /> : <ListChecksIcon />}
                        {tab.label}
                    </span>
                ),
            })),
        [],
    )

    const headerTabsProps = useMemo(
        () => ({
            items: evaluatorTabItems,
            activeKey: activeTab,
            onChange: (key: string) => onTabChange(key as EvaluatorCategory),
        }),
        [activeTab, evaluatorTabItems, onTabChange],
    )

    const filters = useMemo(
        () => (
            <Input.Search
                allowClear
                placeholder="Search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-[320px]"
            />
        ),
        [searchTerm, setSearchTerm],
    )

    const archivedTitle = useMemo(() => {
        if (!isArchived) return undefined

        return (
            <span className="inline-flex items-center gap-2">
                <Button
                    onClick={() => router.push(`${projectURL}/evaluators`)}
                    className="!px-1"
                    aria-label="Back to evaluators"
                    variant="ghost"
                    size="icon-sm"
                >
                    {<ArrowLeft size={16} />}
                </Button>
                <span>Archived Evaluators</span>
            </span>
        )
    }, [isArchived, projectURL, router])

    const renderPrimaryActions = useCallback(
        ({selectedRowKeys, selectedRecords}: EvaluatorsTableSelection) => {
            if (isArchived) return undefined

            const handleBulkArchive = () => {
                const selectedEvaluators = Array.from(
                    new Map(
                        selectedRecords
                            .filter((record) => record.workflowId)
                            .map((record) => [record.workflowId, record]),
                    ).values(),
                )
                if (!selectedEvaluators.length) return

                setDeleteTargetIds(selectedEvaluators.map((record) => record.workflowId))
                setDeleteTargetRevisionIds(
                    selectedEvaluators
                        .map((record) => record.revisionId)
                        .filter((revisionId): revisionId is string => Boolean(revisionId)),
                )
                setIsDeleteModalOpen(true)
            }

            return (
                <Space>
                    {selectedRowKeys.length > 0 ? (
                        <Button onClick={handleBulkArchive} variant="destructive">
                            {<Tray size={14} />}
                            Archive
                        </Button>
                    ) : (
                        <Button
                            onClick={() =>
                                router.push(`${projectURL}/evaluators/archived?tab=${activeTab}`)
                            }
                            variant="ghost"
                        >
                            {<Tray size={14} />}
                            Archived
                        </Button>
                    )}
                    {activeTab === "human" ? (
                        <Button onClick={handleOpenHumanDrawer}>
                            {<PlusOutlined />}
                            Create new
                        </Button>
                    ) : (
                        <EvaluatorTemplateDropdown
                            onSelect={handleSelectTemplate}
                            trigger={
                                <Button>
                                    {<PlusOutlined />}
                                    Create new
                                </Button>
                            }
                        />
                    )}
                </Space>
            )
        },
        [activeTab, handleOpenHumanDrawer, handleSelectTemplate, isArchived, projectURL, router],
    )

    return (
        <PageLayout
            title={isArchived ? archivedTitle : "Evaluators"}
            headerTabsProps={isArchived ? undefined : headerTabsProps}
            className="grow min-h-0"
        >
            <EvaluatorsTable
                mode={isArchived ? "archived" : "active"}
                category={activeTab}
                onRowClick={handleRowClick}
                actions={columnActions}
                searchDeps={[searchTerm]}
                filters={filters}
                renderPrimaryActions={isArchived ? undefined : renderPrimaryActions}
                displayMode="grouped"
            />

            <DeleteEvaluatorsModal
                open={isDeleteModalOpen}
                onCancel={() => {
                    setIsDeleteModalOpen(false)
                    setDeleteTargetIds([])
                    setDeleteTargetRevisionIds([])
                }}
                onConfirm={handleConfirmDelete}
                confirmLoading={isDeleting}
                selectedCount={deleteTargetIds.length}
                revisionIds={deleteTargetRevisionIds}
            />
        </PageLayout>
    )
}

export default memo(EvaluatorsRegistry)
