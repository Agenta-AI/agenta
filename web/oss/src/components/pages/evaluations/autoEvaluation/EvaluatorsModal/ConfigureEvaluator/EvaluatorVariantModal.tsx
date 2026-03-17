import {
    isValidElement,
    useCallback,
    useEffect,
    useMemo,
    useState,
    type ComponentProps,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {CloseCircleOutlined, CloseOutlined} from "@ant-design/icons"
import {Play} from "@phosphor-icons/react"
import {Button, Input, Modal, Tabs, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import type {RegistryRevisionRow} from "@/oss/components/VariantsComponents/store/registryStore"
import {registryPaginatedStore} from "@/oss/components/VariantsComponents/store/registryStore"
import {createRegistryColumns} from "@/oss/components/VariantsComponents/Table/assets/registryColumns"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import type {JSSTheme, Variant} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app/hooks"
import {revision} from "@/oss/state/entities/testset"

import TabLabel from "../../../NewEvaluation/assets/TabLabel"
import SelectAppSection from "../../../NewEvaluation/Components/SelectAppSection"
import type {NewEvaluationAppOption} from "../../../NewEvaluation/types"

type EvaluatorVariantModalProps = {
    variants: Variant[] | null
    setSelectedVariant: Dispatch<SetStateAction<Variant | null>>
    selectedVariant: Variant | null
    selectedRevisionId?: string
} & ComponentProps<typeof Modal>

interface VariantDiagnostics {
    hasWarning: boolean
    message?: string
    columnsKnown: boolean
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightStrong,
    },
    container: {
        "& .ant-modal-body": {
            height: 600,
        },
    },
    tabs: {
        height: "100%",
        display: "flex",
        "& .ant-tabs-nav": {
            minWidth: 220,
        },
        "& .ant-tabs-nav-list": {
            width: "100%",
        },
        "& .ant-tabs-content-holder": {
            flex: 1,
            paddingLeft: theme.padding,
            overflow: "auto",
        },
    },
    searchRow: {
        display: "flex",
        justifyContent: "space-between",
    },
    tabsContainer: {
        height: "100%",
        display: "flex",
        "& .ant-tabs-content-holder": {
            paddingLeft: theme.padding,
            flex: 1,
            overflow: "auto",
        },
        "& .ant-tabs-tab": {
            color: theme.colorTextSecondary,
            "&:hover": {
                backgroundColor: theme.colorInfoBg,
            },
        },
        "& .ant-tabs-ink-bar": {
            display: "none",
        },
        "& .ant-tabs-tab-active": {
            backgroundColor: theme.controlItemBgActive,
            borderRight: `2px solid ${theme.colorPrimary}`,
            color: theme.colorPrimary,
            fontWeight: `${theme.fontWeightMedium} !important`,
        },
    },
}))

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {
        ssr: false,
    },
)

const EMPTY_ACTIONS = {}

const EvaluatorVariantModal = ({
    variants: _variants,
    setSelectedVariant,
    selectedVariant,
    selectedRevisionId,
    ...props
}: EvaluatorVariantModalProps) => {
    const classes = useStyles()
    const appIdFromRoute = useAppId()
    const isAppScoped = Boolean(appIdFromRoute)
    const {apps: availableApps = []} = useAppsData()
    const {redirectUrl} = useURL()

    const [activePanel, setActivePanel] = useState<string>(
        isAppScoped ? "variantPanel" : "appPanel",
    )
    const [searchTerm, setSearchTerm] = useState("")
    const [appSearchTerm, setAppSearchTerm] = useState("")
    const [selectedAppId, setSelectedAppId] = useState<string>("")
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
    const [rowDiagnostics, setRowDiagnostics] = useState<Record<string, VariantDiagnostics>>({})

    const appOptions: NewEvaluationAppOption[] = useMemo(() => {
        const options =
            availableApps.map((app: any) => ({
                label: app.name ?? app.slug ?? "",
                value: app.id,
                type: app.flags?.is_custom
                    ? "custom"
                    : app.flags?.is_chat
                      ? "chat"
                      : ("completion" as string | null),
                createdAt: app.created_at ?? null,
                updatedAt: app.updated_at ?? null,
            })) ?? []

        if (selectedAppId && !options.some((option) => option.value === selectedAppId)) {
            options.push({
                label: selectedAppId,
                value: selectedAppId,
                type: null,
                createdAt: null,
                updatedAt: null,
            })
        }

        return options
    }, [availableApps, selectedAppId])

    const handleCreateApp = useCallback(() => {
        redirectUrl()
    }, [redirectUrl])

    const filteredAppOptions = useMemo(() => {
        if (!appSearchTerm) return appOptions
        return appOptions.filter((option) =>
            option.label.toLowerCase().includes(appSearchTerm.toLowerCase()),
        )
    }, [appOptions, appSearchTerm])

    // Use revision controller to get normalized testcase columns
    const testcaseColumnsAtom = useMemo(
        () =>
            selectedRevisionId
                ? revision.selectors.testcaseColumnsNormalized(selectedRevisionId)
                : atom<string[]>([]),
        [selectedRevisionId],
    )
    const normalizedTestsetColumns = useAtomValue(testcaseColumnsAtom)

    // IVT table for variant selection
    const table = useTableManager<RegistryRevisionRow>({
        datasetStore: registryPaginatedStore.store as never,
        scopeId: "evaluator-variant-selector",
        pageSize: 50,
        searchDeps: [searchTerm],
        rowClassName: "variant-table-row",
    })

    const columns = useMemo(() => createRegistryColumns(EMPTY_ACTIONS), [])

    const onSelectVariant = useCallback((keys: React.Key[]) => {
        const selectedId = keys[0] as string | undefined
        if (selectedId) {
            setSelectedRowKeys([selectedId])
        } else {
            setSelectedRowKeys([])
        }
    }, [])

    const rowSelection = useMemo(
        () => ({
            type: "radio" as const,
            selectedRowKeys: selectedRowKeys as React.Key[],
            onChange: (keys: React.Key[]) => onSelectVariant(keys),
        }),
        [selectedRowKeys, onSelectVariant],
    )

    useEffect(() => {
        if (!props.open) {
            setSearchTerm("")
            setAppSearchTerm("")
            setSelectedRowKeys([])
            setActivePanel(isAppScoped ? "variantPanel" : "appPanel")
            if (!isAppScoped) setSelectedAppId("")
            return
        }

        const derivedAppId = (isAppScoped ? appIdFromRoute : selectedVariant?.appId) ?? ""
        if (derivedAppId) {
            setSelectedAppId(derivedAppId)
            setActivePanel("variantPanel")
        } else {
            setActivePanel("appPanel")
        }
    }, [props.open, isAppScoped, appIdFromRoute, selectedVariant?.appId])

    const loadVariant = useCallback(() => {
        const [selectedRevId] = selectedRowKeys
        if (!selectedRevId) return

        // Read workflow data from molecule
        const workflowData = workflowMolecule.get.data(selectedRevId)
        if (!workflowData) return

        // Build a variant object from the workflow data for the evaluator debug section
        const variantToSet: Variant = {
            id: workflowData.id,
            variantId: workflowData.workflow_variant_id || workflowData.id,
            variantName: workflowData.name || "",
            appId: workflowData.workflow_id || selectedAppId,
            uri: (workflowData.data?.url as string) || (workflowData.data?.uri as string) || "",
            revision: workflowData.version ?? 0,
            parameters: workflowData.data?.parameters || {},
            isCustom: workflowData.flags?.is_custom ?? false,
            baseId: workflowData.workflow_variant_id || "",
            baseName: workflowData.slug || "",
            configName: workflowData.name || "",
        } as any

        setSelectedVariant(variantToSet)
        props.onCancel?.({} as any)
    }, [selectedRowKeys, selectedAppId, setSelectedVariant, props])

    const handlePanelChange = useCallback((key: string) => {
        setActivePanel(key)
    }, [])

    const handleAppSelection = useCallback(
        (value: string) => {
            if (value === selectedAppId) return
            setSelectedAppId(value)
            setSelectedRowKeys([])
            setSearchTerm("")
            setActivePanel("variantPanel")
        },
        [selectedAppId],
    )

    const appSelectionComplete = Boolean(selectedAppId)

    useEffect(() => {
        setRowDiagnostics({})
    }, [selectedAppId])

    // Build selected revision tag label from workflow molecule
    const selectedRevisionTags = useMemo(() => {
        if (!selectedRowKeys.length) return []
        return selectedRowKeys
            .map((key) => {
                const data = workflowMolecule.get.data(key)
                if (!data) return null
                return {
                    revisionId: key,
                    label: `${data.name || "-"} - v${data.version ?? 0}`,
                }
            })
            .filter(Boolean) as {revisionId: string; label: string}[]
    }, [selectedRowKeys])

    const selectedVariantDiagnostics = useMemo(() => {
        const [activeRevisionId] = selectedRowKeys
        if (!activeRevisionId) return undefined
        return rowDiagnostics[String(activeRevisionId)]
    }, [rowDiagnostics, selectedRowKeys])

    const selectedVariantMessage = selectedVariantDiagnostics?.message
    const selectedVariantHasWarning = Boolean(selectedVariantDiagnostics?.hasWarning)

    const loadWarningMessage = selectedVariantMessage

    const modalFooter = (
        <div className="flex items-center justify-end gap-2">
            <Button onClick={() => props.onCancel?.({} as any)}>Cancel</Button>
            <Tooltip title={loadWarningMessage}>
                <span style={{display: "inline-block"}}>
                    <Button
                        type="primary"
                        danger={selectedVariantHasWarning}
                        icon={<Play />}
                        iconPlacement="end"
                        disabled={!selectedRowKeys.length}
                        onClick={loadVariant}
                    >
                        Load variant
                    </Button>
                </span>
            </Tooltip>
        </div>
    )

    const handleRowDiagnostics = useCallback((id: string, meta: VariantDiagnostics) => {
        if (!id) return
        setRowDiagnostics((prev) => {
            const existing = prev[id]
            if (
                existing &&
                existing.hasWarning === meta.hasWarning &&
                existing.message === meta.message &&
                existing.columnsKnown === meta.columnsKnown
            ) {
                return prev
            }
            return {...prev, [id]: meta}
        })
    }, [])

    const SelectionCell = ({
        record,
        node,
        onMetaChange,
    }: {
        record: RegistryRevisionRow
        node: ReactNode
        onMetaChange: (id: string, meta: VariantDiagnostics) => void
    }) => {
        const revisionId = record?.revisionId || ""
        const inputSchemaAtom = useMemo(
            () =>
                revisionId
                    ? workflowMolecule.selectors.inputSchema(revisionId)
                    : atom<Record<string, unknown> | null>(null),
            [revisionId],
        )
        const inputSchema = useAtomValue(inputSchemaAtom)
        const variables = useMemo(() => {
            if (!inputSchema || typeof inputSchema !== "object") return []
            const properties = (inputSchema as Record<string, unknown>).properties
            if (!properties || typeof properties !== "object") return []
            return Object.keys(properties as Record<string, unknown>).filter((k) => k.length > 0)
        }, [inputSchema])

        const expectedVariables = useMemo(
            () =>
                Array.isArray(variables)
                    ? variables
                          .map((value) => (typeof value === "string" ? value.trim() : ""))
                          .filter(Boolean)
                    : [],
            [variables],
        )

        const columnsKnown = normalizedTestsetColumns.length > 0

        const missingVariables = useMemo(
            () =>
                columnsKnown
                    ? expectedVariables.filter(
                          (value) => !normalizedTestsetColumns.includes(value.toLowerCase()),
                      )
                    : [],
            [columnsKnown, expectedVariables, normalizedTestsetColumns],
        )

        const hasWarning =
            columnsKnown && expectedVariables.length > 0 && missingVariables.length > 0

        const message = useMemo(() => {
            if (!expectedVariables.length) return undefined
            if (!columnsKnown) return "Analyzing testset columns..."
            if (missingVariables.length > 0) {
                const missingList = missingVariables.join(", ")
                return `The selected testset is missing required inputs for this variant: {{${missingList}}}`
            }
            return undefined
        }, [columnsKnown, expectedVariables.length, missingVariables])

        useEffect(() => {
            if (!revisionId) return
            onMetaChange(revisionId, {hasWarning, message, columnsKnown})
        }, [revisionId, hasWarning, message, columnsKnown, onMetaChange])

        if (!isValidElement(node)) {
            return message ? (
                <Tooltip title={message}>
                    <span style={{display: "inline-block"}}>{node}</span>
                </Tooltip>
            ) : (
                <span style={{display: "inline-block"}}>{node}</span>
            )
        }

        const wrappedNode = <span style={{display: "inline-block"}}>{node}</span>

        return message ? <Tooltip title={message}>{wrappedNode}</Tooltip> : wrappedNode
    }

    const variantTabContent = (
        <div className="flex flex-col flex-1 min-h-0 gap-3">
            <div className={classes.searchRow}>
                <Input.Search
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search variants"
                    allowClear
                    className="w-[240px]"
                    disabled={!appSelectionComplete}
                />
            </div>

            {appSelectionComplete ? (
                <div className="h-[455px]">
                    <InfiniteVirtualTableFeatureShell<RegistryRevisionRow>
                        {...table.shellProps}
                        columns={columns}
                        rowSelection={{
                            ...rowSelection,
                            renderCell: (
                                _: any,
                                record: any,
                                __: number,
                                originNode: ReactNode,
                            ) => (
                                <SelectionCell
                                    record={record as RegistryRevisionRow}
                                    node={originNode}
                                    onMetaChange={handleRowDiagnostics}
                                />
                            ),
                        }}
                        autoHeight
                        locale={{
                            emptyText: (
                                <NoResultsFound
                                    className="!py-10"
                                    description="No available variants found to display"
                                />
                            ),
                        }}
                    />
                </div>
            ) : (
                <Typography.Text type="secondary">
                    Select an application first to load this section.
                </Typography.Text>
            )}
        </div>
    )

    const tabs = useMemo(() => {
        const showAppEmptyState = appOptions.length === 0
        const noSearchResults = filteredAppOptions.length === 0 && !showAppEmptyState

        return [
            {
                key: "appPanel",
                label: (
                    <TabLabel tabTitle="Application" completed={appSelectionComplete}>
                        {appSelectionComplete && (
                            <Tag
                                closeIcon={!isAppScoped ? <CloseCircleOutlined /> : null}
                                onClose={() => {
                                    if (!isAppScoped) {
                                        setSelectedAppId("")
                                        setSelectedRowKeys([])
                                        setActivePanel("appPanel")
                                    }
                                }}
                            >
                                {appOptions.find((opt) => opt.value === selectedAppId)?.label ??
                                    selectedAppId}
                            </Tag>
                        )}
                    </TabLabel>
                ),
                children: (
                    <div className="flex flex-col gap-2">
                        {showAppEmptyState ? (
                            <NoResultsFound
                                title="No applications found"
                                description="You need at least one application before selecting a variant. Head to App Management to create one."
                                primaryActionLabel="Create an app"
                                onPrimaryAction={handleCreateApp}
                            />
                        ) : (
                            <>
                                <div className={classes.searchRow}>
                                    <Input.Search
                                        value={appSearchTerm}
                                        onChange={(e) => setAppSearchTerm(e.target.value)}
                                        placeholder="Search applications"
                                        allowClear
                                        className="w-[240px]"
                                        disabled={isAppScoped}
                                    />
                                </div>
                                <SelectAppSection
                                    apps={filteredAppOptions}
                                    selectedAppId={selectedAppId}
                                    onSelectApp={handleAppSelection}
                                    disabled={isAppScoped}
                                    emptyText={
                                        noSearchResults
                                            ? "No applications match your search"
                                            : undefined
                                    }
                                />
                                {!appSelectionComplete && !isAppScoped ? (
                                    <Typography.Text type="secondary">
                                        Please select an application to continue.
                                    </Typography.Text>
                                ) : null}
                            </>
                        )}
                    </div>
                ),
            },
            {
                key: "variantPanel",
                label: (
                    <Tooltip title={selectedVariantMessage}>
                        <span>
                            <TabLabel tabTitle="Variant" completed={selectedRowKeys.length > 0}>
                                {selectedRevisionTags.map(({revisionId, label}) => (
                                    <Tag
                                        key={revisionId}
                                        closeIcon={<CloseCircleOutlined />}
                                        onClose={() => setSelectedRowKeys([])}
                                    >
                                        {label}
                                    </Tag>
                                ))}
                            </TabLabel>
                        </span>
                    </Tooltip>
                ),
                children: variantTabContent,
            },
        ]
    }, [
        appOptions,
        appSelectionComplete,
        handleAppSelection,
        isAppScoped,
        selectedAppId,
        selectedRevisionTags,
        selectedRowKeys,
        setActivePanel,
        setSelectedAppId,
        setSelectedRowKeys,
        filteredAppOptions,
        variantTabContent,
        handleCreateApp,
        selectedVariantHasWarning,
        selectedVariantMessage,
    ])

    return (
        <Modal
            closeIcon={null}
            width={1150}
            className={classes.container}
            title={
                <div className="flex items-center justify-between">
                    <Typography.Text className={classes.title}>
                        Select variant to run
                    </Typography.Text>
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
                </div>
            }
            centered
            {...props}
            footer={modalFooter}
        >
            <Tabs
                activeKey={activePanel}
                onChange={handlePanelChange}
                items={tabs}
                tabPlacement="left"
                className={clsx([
                    classes.tabsContainer,
                    "[&_.ant-tabs-tab]:!p-2 [&_.ant-tabs-tab]:!mt-1",
                    "[&_.ant-tabs-nav]:!w-[240px]",
                ])}
            />
        </Modal>
    )
}

export default EvaluatorVariantModal
