import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {archiveWorkflow, invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {createEvaluatorFromTemplate} from "@agenta/entities/workflow"
import {PageLayout} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {PlusOutlined} from "@ant-design/icons"
import {ChartDonutIcon, ListChecksIcon} from "@phosphor-icons/react"
import {Button, Input, Space} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import type {Evaluator} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

import {DEFAULT_EVALUATOR_TAB, EVALUATOR_TABS} from "./assets/constants"
import type {EvaluatorCategory} from "./assets/types"
import DeleteEvaluatorsModal from "./components/DeleteEvaluatorsModal"
import EvaluatorTemplateDropdown from "./components/EvaluatorTemplateDropdown"
import {openEvaluatorDrawerAtom} from "./Drawers/EvaluatorDrawer/store/evaluatorDrawerStore"
import {openHumanEvaluatorDrawerAtom} from "./Drawers/HumanEvaluatorDrawer/store"
import {evaluatorCategoryAtom, evaluatorSearchTermAtom} from "./store/evaluatorFilterAtoms"
import type {EvaluatorTableRow} from "./store/evaluatorsPaginatedStore"
import {
    evaluatorsPaginatedStore,
    clearEvaluatorWorkflowNameCache,
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
    const setSearchTerm = useSetAtom(evaluatorSearchTermAtom)
    const refreshStore = useSetAtom(evaluatorsPaginatedStore.actions.refresh)

    // Global drawer actions
    const openEvaluatorDrawer = useSetAtom(openEvaluatorDrawerAtom)
    const openHumanDrawer = useSetAtom(openHumanEvaluatorDrawerAtom)

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
    const [deleteTargetNames, setDeleteTargetNames] = useState<string[]>([])

    const refetchAll = useCallback(() => {
        clearEvaluatorWorkflowNameCache()
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
        async (evaluator: Evaluator) => {
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
        [openEvaluatorDrawer],
    )

    const handleRowClick = useCallback(
        (record: EvaluatorTableRow) => {
            if (activeTab === "human") {
                openHumanDrawer({
                    mode: "edit",
                    evaluator: record.raw,
                    onSuccess: () => refetchAll(),
                })
            } else {
                const revisionId = record.revisionId || record.workflowId
                openEvaluatorDrawer({
                    entityId: revisionId,
                    mode: "view",
                })
            }
        },
        [activeTab, openEvaluatorDrawer, openHumanDrawer, refetchAll],
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
            clearEvaluatorWorkflowNameCache()

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
            setDeleteTargetNames([])
        }
    }, [deleteTargetIds, refetchAll, activeTab])

    const columnActions = useMemo(
        () => ({
            handleConfigure: (record: EvaluatorTableRow) => {
                const revisionId = record.revisionId || record.workflowId
                openEvaluatorDrawer({
                    entityId: revisionId,
                    mode: "view",
                })
            },
            handleEdit: (record: EvaluatorTableRow) => {
                openHumanDrawer({
                    mode: "edit",
                    evaluator: record.raw,
                    onSuccess: () => refetchAll(),
                })
            },
            handleDelete: (record: EvaluatorTableRow) => {
                if (!record.workflowId) return
                setDeleteTargetIds([record.workflowId])
                setDeleteTargetNames([record.name])
                setIsDeleteModalOpen(true)
            },
        }),
        [openEvaluatorDrawer, openHumanDrawer, refetchAll],
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
                filters={filters}
                primaryActions={primaryActions}
                displayMode="grouped"
            />

            <DeleteEvaluatorsModal
                open={isDeleteModalOpen}
                onCancel={() => {
                    setIsDeleteModalOpen(false)
                    setDeleteTargetIds([])
                    setDeleteTargetNames([])
                }}
                onConfirm={handleConfirmDelete}
                confirmLoading={isDeleting}
                selectedCount={deleteTargetIds.length}
                selectedNames={deleteTargetNames}
            />
        </PageLayout>
    )
}

export default memo(EvaluatorsRegistry)
