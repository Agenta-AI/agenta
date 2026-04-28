import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {
    archiveWorkflow,
    invalidateWorkflowsListCache,
    invalidateEvaluatorsListCache,
    createEvaluatorFromTemplate,
    type EvaluatorCatalogTemplate,
} from "@agenta/entities/workflow"
import {workflowRevisionDrawerNavigationIdsAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {PageLayout} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {PlusOutlined} from "@ant-design/icons"
import {ChartDonutIcon, ListChecksIcon} from "@phosphor-icons/react"
import {Button, Input, Space} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import {appIdentifiersAtom, useQueryParamState} from "@/oss/state/appState"
import {openEvaluatorDrawerAtom} from "@/oss/state/evaluator/evaluatorDrawerStore"
import {getProjectValues} from "@/oss/state/project"
import {recentEvaluatorIdAtom} from "@/oss/state/workflow"

import {DEFAULT_EVALUATOR_TAB, EVALUATOR_TABS} from "./assets/constants"
import type {EvaluatorCategory} from "./assets/types"
import DeleteEvaluatorsModal from "./components/DeleteEvaluatorsModal"
import EvaluatorTemplateDropdown from "./components/EvaluatorTemplateDropdown"
import {openHumanEvaluatorDrawerAtom} from "./Drawers/HumanEvaluatorDrawer/store"
import {evaluatorCategoryAtom, evaluatorSearchTermAtom} from "./store/evaluatorFilterAtoms"
import type {EvaluatorTableRow} from "./store/evaluatorsPaginatedStore"
import {
    evaluatorsPaginatedStore,
    clearEvaluatorWorkflowCache,
} from "./store/evaluatorsPaginatedStore"
import EvaluatorsTable from "./Table/EvaluatorsTable"

const isValidEvaluatorTab = (value: string): value is EvaluatorCategory => {
    return EVALUATOR_TABS.some(({key}) => key === value)
}

const EvaluatorsRegistry = ({scope = "project"}: {scope?: "project" | "app"}) => {
    // Tab state: atom drives the paginated store's metaAtom, query param syncs URL
    const [activeTab, setActiveTab] = useAtom(evaluatorCategoryAtom)
    const [tabState, setTabState] = useQueryParam("tab", activeTab)
    const onboardingWidgetActivation = useAtomValue(onboardingWidgetActivationAtom)
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)

    // Search: atom drives the paginated store's metaAtom
    const [searchTerm, setSearchTerm] = useAtom(evaluatorSearchTermAtom)
    const refreshStore = useSetAtom(evaluatorsPaginatedStore.actions.refresh)

    // URL-driven drawer (same pattern as variants registry)
    const [, setQueryRevision] = useQueryParamState("revisionId")
    const openEvaluatorDrawer = useSetAtom(openEvaluatorDrawerAtom)
    const openHumanDrawer = useSetAtom(openHumanEvaluatorDrawerAtom)

    // Phase 5: full-page navigation for evaluator EDIT (drawer remains for
    // human + create + the per-row "Quick edit" action). Writes
    // recentEvaluatorIdAtom alongside the navigation push.
    const router = useRouter()
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    const setRecentEvaluatorId = useSetAtom(recentEvaluatorIdAtom)
    const navigateToEvaluatorPage = useCallback(
        (evaluatorId: string) => {
            if (!workspaceId || !projectId || !evaluatorId) return false
            setRecentEvaluatorId(evaluatorId)
            void router.push(
                `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
                    projectId,
                )}/apps/${encodeURIComponent(evaluatorId)}/playground`,
            )
            return true
        },
        [workspaceId, projectId, setRecentEvaluatorId, router],
    )

    // Navigation: keep drawer prev/next list in sync with visible table rows
    const EVAL_CONTROLLER_PARAMS = useMemo(() => ({scopeId: "evaluators", pageSize: 50}), [])
    const evalTableState = useAtomValue(
        evaluatorsPaginatedStore.selectors.state(EVAL_CONTROLLER_PARAMS),
    )
    const setNavigationIds = useSetAtom(workflowRevisionDrawerNavigationIdsAtom)

    useEffect(() => {
        const navIds = evalTableState.rows
            .map((r) => r.revisionId)
            .filter((id): id is string => Boolean(id))
        if (navIds.length > 0) {
            setNavigationIds(navIds)
        }
    }, [evalTableState.rows, setNavigationIds])

    useEffect(() => {
        if (isValidEvaluatorTab(tabState)) {
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
    }, [tabState, activeTab])

    useEffect(() => {
        if (onboardingWidgetActivation !== "create-evaluator") return
        setActiveTab("automatic")
        setTabState("automatic")
        setOnboardingWidgetActivation(null)
    }, [onboardingWidgetActivation, setActiveTab, setTabState, setOnboardingWidgetActivation])

    // Modal states
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
    const [deleteTargetRevisionIds, setDeleteTargetRevisionIds] = useState<string[]>([])

    const refetchAll = useCallback(() => {
        clearEvaluatorWorkflowCache()
        invalidateEvaluatorsListCache()
        refreshStore()
    }, [refreshStore])

    const onTabChange = useCallback(
        (value: EvaluatorCategory) => {
            setActiveTab(value)
            setTabState(value)
        },
        [setActiveTab, setTabState],
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
                // Phase 5 post-create transition: after the user commits a new
                // evaluator from the create-drawer, land them on the evaluator's
                // full-page playground. Closes the loop with the "first part"
                // workflow-creation design — drawer for create, full-page for edit.
                onEvaluatorCreated: (configId?: string) => {
                    refetchAll()
                    if (configId) {
                        navigateToEvaluatorPage(configId)
                    }
                },
            })
        },
        [openEvaluatorDrawer, refetchAll, navigateToEvaluatorPage],
    )

    const handleRowClick = useCallback(
        (record: EvaluatorTableRow) => {
            if (activeTab === "human") {
                // Human evaluators don't have a full-page playground; keep the
                // existing drawer-edit flow.
                openHumanDrawer({
                    mode: "edit",
                    workflowId: record.workflowId,
                    revisionId: record.revisionId,
                    onSuccess: () => refetchAll(),
                })
                return
            }
            // Phase 5: row click navigates to the evaluator's full-page
            // playground. The drawer-open via "Configure" menu item (handled in
            // columnActions.handleConfigure below) stays as the secondary
            // "Quick edit" affordance.
            const navigated = record.workflowId ? navigateToEvaluatorPage(record.workflowId) : false
            if (!navigated) {
                // Defensive fallback: workspace/project not ready yet, or no
                // workflow id on the record. Open the drawer so the user can
                // still inspect.
                const revisionId = record.revisionId || record.workflowId
                if (revisionId) {
                    setQueryRevision(revisionId, {shallow: true})
                }
            }
        },
        [activeTab, openHumanDrawer, refetchAll, navigateToEvaluatorPage, setQueryRevision],
    )

    const handleConfirmDelete = useCallback(async () => {
        if (!deleteTargetIds.length) return

        try {
            setIsDeleting(true)
            const {projectId} = getProjectValues()

            if (activeTab !== "human") {
                const canDelete = await checkIfResourceValidForDeletion({
                    resourceType: "evaluator_config",
                    resourceIds: deleteTargetIds,
                })
                if (!canDelete) return
            }

            await Promise.all(deleteTargetIds.map((id) => archiveWorkflow(projectId, id)))
            invalidateWorkflowsListCache()
            invalidateEvaluatorsListCache()
            clearEvaluatorWorkflowCache()

            message.success(
                deleteTargetIds.length === 1
                    ? "Evaluator deleted"
                    : `${deleteTargetIds.length} evaluators deleted`,
            )

            refetchAll()
        } catch (error) {
            console.error(error)
            message.error("Failed to delete evaluators")
        } finally {
            setIsDeleting(false)
            setIsDeleteModalOpen(false)
            setDeleteTargetIds([])
            setDeleteTargetRevisionIds([])
        }
    }, [deleteTargetIds, refetchAll, activeTab])

    const columnActions = useMemo(
        () => ({
            handleConfigure: (record: EvaluatorTableRow) => {
                const revisionId = record.revisionId || record.workflowId
                if (revisionId) {
                    setQueryRevision(revisionId, {shallow: true})
                }
            },
            handleEdit: (record: EvaluatorTableRow) => {
                openHumanDrawer({
                    mode: "edit",
                    workflowId: record.workflowId,
                    revisionId: record.revisionId,
                    onSuccess: () => refetchAll(),
                })
            },
            handleDelete: (record: EvaluatorTableRow) => {
                if (!record.workflowId) return
                setDeleteTargetIds([record.workflowId])
                setDeleteTargetRevisionIds([record.revisionId])
                setIsDeleteModalOpen(true)
            },
        }),
        [setQueryRevision, openHumanDrawer, refetchAll],
    )

    const activeTabLabel = useMemo(() => {
        return EVALUATOR_TABS.find((tab) => tab.key === activeTab)?.label || "Evaluators"
    }, [activeTab])

    const breadcrumbKey = scope === "project" ? "projectPage" : "appPage"

    useBreadcrumbsEffect(
        {
            breadcrumbs: {[breadcrumbKey]: {label: activeTabLabel}},
            type: "append",
            condition: true,
        },
        [breadcrumbKey, activeTabLabel],
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
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-[320px]"
            />
        ),
        [setSearchTerm],
    )

    const primaryActions = useMemo(
        () => (
            <Space>
                {activeTab === "human" ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenHumanDrawer}>
                        Create new
                    </Button>
                ) : (
                    <EvaluatorTemplateDropdown
                        onSelect={handleSelectTemplate}
                        trigger={
                            <Button type="primary" icon={<PlusOutlined />}>
                                Create new
                            </Button>
                        }
                    />
                )}
            </Space>
        ),
        [activeTab, handleOpenHumanDrawer, handleSelectTemplate],
    )

    return (
        <PageLayout title="Evaluators" headerTabsProps={headerTabsProps} className="grow min-h-0">
            <EvaluatorsTable
                category={activeTab}
                onRowClick={handleRowClick}
                actions={columnActions}
                searchDeps={[searchTerm]}
                filters={filters}
                primaryActions={primaryActions}
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
