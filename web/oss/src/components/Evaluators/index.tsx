import {memo, useCallback, useEffect, useMemo, useState, type ChangeEvent, type Key} from "react"

import {message} from "@agenta/ui/app-message"
import {DeleteOutlined, PlusOutlined} from "@ant-design/icons"
import {ChartDonutIcon, ListChecksIcon} from "@phosphor-icons/react"
import {Button, Input, Space} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {useLocalStorage} from "usehooks-ts"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {AnnotateDrawerSteps} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/enum"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import {deleteEvaluatorConfig} from "@/oss/services/evaluations/api"
import {deleteHumanEvaluator} from "@/oss/services/evaluators"
import {useProjectData} from "@/oss/state/project/hooks"

import PageLayout from "../PageLayout/PageLayout"

import {
    DEFAULT_EVALUATOR_TAB,
    EVALUATOR_TABLE_STORAGE_PREFIX,
    EVALUATOR_TABS,
} from "./assets/constants"
import getColumns from "./assets/getColumns"
import {EvaluatorCategory, EvaluatorRegistryRow} from "./assets/types"
import DeleteEvaluatorsModal from "./components/DeleteEvaluatorsModal"
import SelectEvaluatorModal from "./components/SelectEvaluatorModal"
import useEvaluatorsRegistryData from "./hooks/useEvaluatorsRegistryData"

const AnnotateDrawer = dynamic(() => import("@/oss/components/SharedDrawers/AnnotateDrawer"), {
    ssr: false,
})

const isValidEvaluatorTab = (value: string): value is EvaluatorCategory => {
    return EVALUATOR_TABS.some(({key}) => key === value)
}

const EvaluatorsRegistry = ({scope = "project"}: {scope?: "project" | "app"}) => {
    const {projectId} = useProjectData()
    const router = useRouter()
    const {projectURL} = useURL()
    const storageKey = useMemo(
        () => `${EVALUATOR_TABLE_STORAGE_PREFIX}-${scope}-${projectId || "global"}-tab`,
        [projectId, scope],
    )
    const [activeTab, setActiveTab] = useLocalStorage<EvaluatorCategory>(
        storageKey,
        DEFAULT_EVALUATOR_TAB,
    )
    const [tabState, setTabState] = useQueryParam("tab", activeTab)
    const onboardingWidgetActivation = useAtomValue(onboardingWidgetActivationAtom)
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)

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
        setIsSelectEvaluatorModalOpen(true)
        setOnboardingWidgetActivation(null)
    }, [onboardingWidgetActivation, setActiveTab, setTabState, setOnboardingWidgetActivation])

    // states
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [isSelectEvaluatorModalOpen, setIsSelectEvaluatorModalOpen] = useState(false)
    const [isAnnotateDrawerOpen, setIsAnnotateDrawerOpen] = useState(false)
    const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create")
    const [evaluatorToEdit, setEvaluatorToEdit] = useState<EvaluatorRegistryRow["raw"] | null>(null)

    const {rows, isLoading, refetchAll} = useEvaluatorsRegistryData(activeTab)

    const rowsById = useMemo(() => {
        return new Map(rows.map((row) => [row.id, row]))
    }, [rows])

    useEffect(() => {
        setSelectedRowKeys((prev) => {
            const validKeys = prev.filter((key) => rowsById.has(String(key)))
            return validKeys.length === prev.length ? prev : validKeys
        })
    }, [rowsById])

    const filteredRows = useMemo(() => {
        if (!searchTerm) return rows

        return rows.filter((row) => {
            const haystack = [
                row.name,
                row.slug,
                row.typeBadge.label,
                row.versionLabel,
                row.modifiedBy,
                ...row.tags,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()

            return haystack.includes(searchTerm.trim().toLowerCase())
        })
    }, [rows, searchTerm])

    const selectedRows = useMemo(
        () => selectedRowKeys.map((key) => rowsById.get(String(key))).filter(Boolean),
        [selectedRowKeys, rowsById],
    ) as EvaluatorRegistryRow[]

    const selectedNames = useMemo(() => selectedRows.map((row) => row.name), [selectedRows])

    const onTabChange = useCallback(
        (value: EvaluatorCategory) => {
            setActiveTab(value)
            setSelectedRowKeys([])
            setTabState(value)
        },
        [setActiveTab, setTabState],
    )

    const onSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value)
    }, [])

    const handleOpenHumanDrawer = useCallback(() => {
        setDrawerMode("create")
        setEvaluatorToEdit(null)
        setIsAnnotateDrawerOpen(true)
    }, [])

    const handleOpenCreateModal = useCallback(() => {
        if (activeTab === "human") {
            handleOpenHumanDrawer()
            return
        }
        setIsSelectEvaluatorModalOpen(true)
    }, [activeTab, handleOpenHumanDrawer])

    const handleCloseSelectModal = useCallback(() => {
        setIsSelectEvaluatorModalOpen(false)
    }, [])

    const closeAnnotateDrawer = useCallback(() => {
        setIsAnnotateDrawerOpen(false)
        setEvaluatorToEdit(null)
        setDrawerMode("create")
    }, [])

    const onSavedEvaluator = useCallback(
        async (_slug?: string) => {
            try {
                await refetchAll()
            } catch (error) {
                console.error(error)
            } finally {
                closeAnnotateDrawer()
            }
        },
        [refetchAll, closeAnnotateDrawer],
    )

    const openDrawerForRecord = useCallback(
        (record: EvaluatorRegistryRow) => {
            if (activeTab !== "human") return
            setDrawerMode("edit")
            setEvaluatorToEdit(record.raw)
            setIsAnnotateDrawerOpen(true)
        },
        [activeTab],
    )

    const handleNavigateToConfigure = useCallback(
        async (record: EvaluatorRegistryRow) => {
            const raw = record.raw as EvaluatorRegistryRow["raw"] & {kind?: string}
            const isConfig = raw && raw.kind === "config"
            const targetId = isConfig ? record.id : (record.slug as string)

            await router.push(`${projectURL}/evaluators/configure/${encodeURIComponent(targetId)}`)
        },
        [projectURL, router],
    )

    const createEvaluatorDrawerProps = useMemo(
        () => ({
            mode: drawerMode,
            evaluator: drawerMode === "edit" ? evaluatorToEdit || undefined : undefined,
            onSuccess: onSavedEvaluator,
            skipPostCreateStepChange: drawerMode === "create",
        }),
        [drawerMode, evaluatorToEdit, onSavedEvaluator],
    )

    const handleConfirmDelete = useCallback(async () => {
        if (!selectedRows.length) return
        const ids = selectedRows.map((row) => row.id).filter(Boolean) as string[]
        if (!ids.length) return

        try {
            setIsDeleting(true)

            if (activeTab === "human") {
                await Promise.all(ids.map((id) => deleteHumanEvaluator(id)))
            } else {
                const canDelete = await checkIfResourceValidForDeletion({
                    resourceType: "evaluator_config",
                    resourceIds: ids,
                })
                if (!canDelete) return

                await Promise.all(ids.map((id) => deleteEvaluatorConfig(id)))
            }

            message.success(
                ids.length === 1 ? "Evaluator deleted" : `${ids.length} evaluators deleted`,
            )

            setSelectedRowKeys([])
            await refetchAll()
        } catch (error) {
            console.error(error)
            message.error("Failed to delete evaluators")
        } finally {
            setIsDeleting(false)
            setIsDeleteModalOpen(false)
        }
    }, [selectedRows, refetchAll, activeTab])

    const handleRowDelete = useCallback(
        (record: EvaluatorRegistryRow) => {
            if (!record?.id) return
            setSelectedRowKeys([record.id])
            setIsDeleteModalOpen(true)
        },
        [setIsDeleteModalOpen, setSelectedRowKeys],
    )

    const tableColumns = useMemo(
        () =>
            getColumns({
                category: activeTab,
                onEdit: openDrawerForRecord,
                onConfigure: handleNavigateToConfigure,
                onDelete: handleRowDelete,
            }),
        [activeTab],
    )

    const activeTabLabel = useMemo(() => {
        return EVALUATOR_TABS.find((tab) => tab.key === activeTab)?.label || "Evaluators"
    }, [activeTab])

    useEffect(() => {
        setSelectedRowKeys([])
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

    const isDeleteDisabled = selectedRowKeys.length === 0
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

    return (
        <PageLayout title="Evaluators" headerTabsProps={headerTabsProps}>
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Input.Search
                        allowClear
                        placeholder="Search"
                        value={searchTerm}
                        onChange={onSearch}
                        className="w-[320px]"
                    />

                    <Space>
                        <Button
                            icon={<DeleteOutlined />}
                            disabled={isDeleteDisabled}
                            type="text"
                            danger
                            onClick={() => setIsDeleteModalOpen(true)}
                        >
                            Delete
                        </Button>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={handleOpenCreateModal}
                        >
                            Create new
                        </Button>
                    </Space>
                </div>
                <EnhancedTable
                    uniqueKey={EVALUATOR_TABLE_STORAGE_PREFIX}
                    loading={isLoading}
                    columns={tableColumns}
                    dataSource={filteredRows}
                    rowKey={(record) => record.id}
                    rowSelection={{
                        type: "checkbox",
                        columnWidth: 48,
                        fixed: "left",
                        selectedRowKeys,
                        onChange: (keys) => setSelectedRowKeys(keys as Key[]),
                    }}
                    tableLayout="fixed"
                    virtualized
                    className="flex-1"
                    onRow={(record) => ({
                        className: "cursor-pointer",
                        onClick: () => {
                            activeTab === "human"
                                ? openDrawerForRecord(record)
                                : handleNavigateToConfigure(record)
                        },
                    })}
                />
            </div>

            <DeleteEvaluatorsModal
                open={isDeleteModalOpen}
                onCancel={() => {
                    setIsDeleteModalOpen(false)
                    setSelectedRowKeys([])
                }}
                onConfirm={handleConfirmDelete}
                confirmLoading={isDeleting}
                selectedCount={selectedRowKeys.length}
                selectedNames={selectedNames}
            />

            <SelectEvaluatorModal
                open={isSelectEvaluatorModalOpen}
                onCancel={handleCloseSelectModal}
            />

            <AnnotateDrawer
                open={isAnnotateDrawerOpen}
                onClose={closeAnnotateDrawer}
                showOnly={{createEvaluatorUi: true}}
                initialStep={AnnotateDrawerSteps.CREATE_EVALUATOR}
                createEvaluatorProps={createEvaluatorDrawerProps}
                closeOnLayoutClick={false}
            />
        </PageLayout>
    )
}

export default memo(EvaluatorsRegistry)
