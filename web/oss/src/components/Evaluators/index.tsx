import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {
    archiveWorkflow,
    createEvaluatorFromTemplate,
    type EvaluatorCatalogTemplate,
    invalidateEvaluatorsListCache,
    invalidateWorkflowsListCache,
    unarchiveWorkflow,
} from "@agenta/entities/workflow"
import {workflowRevisionDrawerNavigationIdsAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {PageLayout} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {PlusOutlined} from "@ant-design/icons"
import {ChartDonutIcon, ListChecksIcon, Tray} from "@phosphor-icons/react"
import {Button, Input, Space} from "antd"
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
import {useQueryParamState} from "@/oss/state/appState"
import {openEvaluatorDrawerAtom} from "@/oss/state/evaluator/evaluatorDrawerStore"
import {getProjectValues} from "@/oss/state/project"

import {DEFAULT_EVALUATOR_TAB, EVALUATOR_TABS} from "./assets/constants"
import type {EvaluatorCategory} from "./assets/types"
import DeleteEvaluatorsModal from "./components/DeleteEvaluatorsModal"
import EvaluatorTemplateDropdown from "./components/EvaluatorTemplateDropdown"
import {openHumanEvaluatorDrawerAtom} from "./Drawers/HumanEvaluatorDrawer/store"
import type {EvaluatorTableRow} from "./store/evaluatorsPaginatedStore"
import {getEvaluatorsTableState} from "./store/evaluatorsPaginatedStore"
import EvaluatorsTable from "./Table/EvaluatorsTable"

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

    const controllerParams = useMemo(
        () => ({
            scopeId: isArchived ? "archived-evaluators" : "evaluators",
            pageSize: EVALUATOR_PAGE_SIZE,
        }),
        [isArchived],
    )
    const evalTableState = useAtomValue(tableState.paginatedStore.selectors.state(controllerParams))

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

            if (isArchived) {
                const params = new URLSearchParams({
                    tab: "automatic",
                    revisionId,
                })
                router.push(`${projectURL}/evaluators?${params.toString()}`)
                return
            }

            setQueryRevision(revisionId, {shallow: true})
        },
        [isArchived, projectURL, router, setQueryRevision],
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
                onEvaluatorCreated: () => refetchAll(),
            })
        },
        [openEvaluatorDrawer, refetchAll],
    )

    const handleRowClick = useCallback(
        (record: EvaluatorTableRow) => {
            if (activeTab === "human") {
                openHumanEvaluator(record)
                return
            }

            openAutomaticEvaluator(record)
        },
        [activeTab, openAutomaticEvaluator, openHumanEvaluator],
    )

    const handleRestore = useCallback(async (record: EvaluatorTableRow) => {
        try {
            const {projectId} = getProjectValues()
            if (!projectId || !record.workflowId) return

            await unarchiveWorkflow(projectId, record.workflowId)
            invalidateWorkflowsListCache()
            invalidateEvaluatorsListCache()
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

            await Promise.all(deleteTargetIds.map((id) => archiveWorkflow(projectId, id)))
            invalidateWorkflowsListCache()
            invalidateEvaluatorsListCache()

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
    }, [activeTab, deleteTargetIds])

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
                          setDeleteTargetRevisionIds([record.revisionId])
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

    const primaryActions = useMemo(() => {
        if (isArchived) return undefined

        return (
            <Space>
                <Button
                    icon={<Tray size={14} />}
                    onClick={() =>
                        router.push(`${projectURL}/evaluators/archived?tab=${activeTab}`)
                    }
                    type="text"
                >
                    Archived
                </Button>
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
        )
    }, [activeTab, handleOpenHumanDrawer, handleSelectTemplate, isArchived, projectURL, router])

    return (
        <PageLayout
            title={isArchived ? undefined : "Evaluators"}
            headerTabsProps={isArchived ? undefined : headerTabsProps}
            className={isArchived ? "grow min-h-0 !pl-0" : "grow min-h-0"}
        >
            <EvaluatorsTable
                mode={isArchived ? "archived" : "active"}
                category={activeTab}
                onRowClick={handleRowClick}
                actions={columnActions}
                searchDeps={[searchTerm]}
                filters={filters}
                primaryActions={isArchived ? undefined : primaryActions}
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
