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

import {testsetCsvDataQueryAtomFamily} from "@agenta/oss/src/components/Playground/Components/Modals/LoadTestsetModal/assets/testsetCsvData"
import {CloseCircleOutlined, CloseOutlined} from "@ant-design/icons"
import {Play} from "@phosphor-icons/react"
import {Button, Input, Modal, Tabs, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import useAppVariantRevisions from "@/oss/lib/hooks/useAppVariantRevisions"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {JSSTheme, ListAppsItem, Variant} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app/hooks"
import {stablePromptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {useTestsetsData} from "@/oss/state/testset"

import TabLabel from "../../../NewEvaluation/assets/TabLabel"
import SelectAppSection from "../../../NewEvaluation/Components/SelectAppSection"
import type {NewEvaluationAppOption} from "../../../NewEvaluation/types"

import {buildVariantFromRevision} from "./variantUtils"

type EvaluatorVariantModalProps = {
    variants: Variant[] | null
    setSelectedVariant: Dispatch<SetStateAction<Variant | null>>
    selectedVariant: Variant | null
    selectedTestsetId?: string
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

const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const EvaluatorVariantModal = ({
    variants: _variants,
    setSelectedVariant,
    selectedVariant,
    selectedTestsetId,
    ...props
}: EvaluatorVariantModalProps) => {
    console.log("EvaluatorVariantModal")
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
            (availableApps as ListAppsItem[]).map((app) => ({
                label: app.app_name,
                value: app.app_id,
                type: app.app_type ?? null,
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

    const {columnsByTestsetId} = useTestsetsData({
        enabled: Boolean(props.open),
    })

    const testsetCsvQuery = useAtomValue(
        useMemo(
            () =>
                testsetCsvDataQueryAtomFamily({
                    testsetId: selectedTestsetId || "",
                    enabled: Boolean(selectedTestsetId && props.open),
                }),
            [selectedTestsetId, props.open],
        ),
    ) as any
    const testsetCsvData = useMemo(
        () => (Array.isArray(testsetCsvQuery?.data) ? (testsetCsvQuery.data as any[]) : []),
        [testsetCsvQuery],
    )

    const derivedTestsetColumns = useMemo(() => {
        const fromColumns =
            selectedTestsetId && columnsByTestsetId?.[selectedTestsetId]?.length
                ? (columnsByTestsetId[selectedTestsetId] as string[])
                : []

        const firstRow =
            Array.isArray(testsetCsvData) && testsetCsvData.length > 0
                ? (testsetCsvData[0] as Record<string, unknown>)
                : undefined

        let normalizedSource: Record<string, unknown> | undefined
        if (firstRow && typeof firstRow === "object") {
            const candidate =
                "data" in firstRow && firstRow.data && typeof firstRow.data === "object"
                    ? (firstRow.data as Record<string, unknown>)
                    : firstRow
            normalizedSource = candidate
        }

        const fromCsv = normalizedSource ? Object.keys(normalizedSource) : []

        const merged = new Map<string, string>()

        const addValue = (value?: string) => {
            if (!value) return
            const trimmed = value.trim()
            if (!trimmed) return
            if (!merged.has(trimmed.toLowerCase())) {
                merged.set(trimmed.toLowerCase(), trimmed)
            }
        }

        fromColumns.forEach((col) => addValue(typeof col === "string" ? col : String(col)))
        fromCsv.forEach((col) => addValue(typeof col === "string" ? col : String(col)))

        return Array.from(merged.values())
    }, [columnsByTestsetId, selectedTestsetId, testsetCsvData])

    const normalizedTestsetColumns = useMemo(
        () =>
            derivedTestsetColumns
                .map((col) => (typeof col === "string" ? col.trim().toLowerCase() : ""))
                .filter(Boolean),
        [derivedTestsetColumns],
    )

    const {variants: appVariantRevisions, isLoading: variantsLoading} = useAppVariantRevisions(
        selectedAppId || null,
    )

    const {latestRevisions, revisionToVariantMap, revisionById, variantById} = useMemo(() => {
        if (!appVariantRevisions?.length) {
            return {
                latestRevisions: [] as EnhancedVariant[],
                revisionToVariantMap: new Map<string, Variant>(),
                revisionById: new Map<string, EnhancedVariant>(),
                variantById: new Map<string, Variant>(),
            }
        }

        const grouped = new Map<string, EnhancedVariant[]>()
        const revisionLookup = new Map<string, EnhancedVariant>()
        appVariantRevisions.forEach((rev) => {
            if (!rev?.variantId) return
            const key = rev.variantId
            const existing = grouped.get(key) ?? []
            existing.push(rev)
            grouped.set(key, existing)
            if (rev.id) {
                revisionLookup.set(String(rev.id), rev)
            }
        })

        const revisionToVariant = new Map<string, Variant>()
        const variantMap = new Map<string, Variant>()
        const latest: EnhancedVariant[] = []

        grouped.forEach((revisions, variantId) => {
            const sorted = [...revisions].sort(
                (a, b) => (b.updatedAtTimestamp ?? 0) - (a.updatedAtTimestamp ?? 0),
            )
            const baseRevision = sorted[0] ?? revisions[0]
            if (!baseRevision) return

            const baseVariant = buildVariantFromRevision(baseRevision, selectedAppId)
            baseVariant.revisions = sorted

            variantMap.set(variantId, baseVariant)
            sorted.forEach((rev) => {
                if (rev.id) {
                    revisionToVariant.set(String(rev.id), baseVariant)
                }
            })

            latest.push(baseRevision)
        })

        latest.sort((a, b) => (b.updatedAtTimestamp ?? 0) - (a.updatedAtTimestamp ?? 0))

        return {
            latestRevisions: latest,
            revisionToVariantMap: revisionToVariant,
            revisionById: revisionLookup,
            variantById: variantMap,
        }
    }, [appVariantRevisions, selectedAppId])

    useEffect(() => {
        if (!selectedRowKeys.length) return
        const filteredKeys = selectedRowKeys.filter((key) => revisionToVariantMap.has(String(key)))
        if (filteredKeys.length !== selectedRowKeys.length) {
            setSelectedRowKeys(filteredKeys)
        }
    }, [revisionToVariantMap, selectedRowKeys])

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

    useEffect(() => {
        if (!props.open) return
        if (!selectedVariant?.variantId) return
        const variant = variantById.get(selectedVariant.variantId)
        if (!variant?.revisions?.length) return
        const latestRevisionId = variant.revisions[0]?.id
        if (!latestRevisionId) return
        setSelectedRowKeys((prev) => (prev.length ? prev : [String(latestRevisionId)]))
    }, [props.open, variantById, selectedVariant?.variantId])

    const loadVariant = useCallback(() => {
        const [selectedRevisionId] = selectedRowKeys
        if (!selectedRevisionId) return

        const baseVariant = revisionToVariantMap.get(String(selectedRevisionId))
        if (!baseVariant) return

        const variantToSet = {
            ...baseVariant,
            revisions: baseVariant.revisions ? [...baseVariant.revisions] : [],
        }

        setSelectedVariant(variantToSet)
        props.onCancel?.({} as any)
    }, [selectedRowKeys, revisionToVariantMap, setSelectedVariant, props])

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

    const filteredRevisions = useMemo(() => {
        if (!searchTerm) return latestRevisions
        return latestRevisions.filter((item) =>
            (item.variantName || "").toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, latestRevisions])

    useEffect(() => {
        setRowDiagnostics((prev) => {
            if (!prev || Object.keys(prev).length === 0) return prev
            const allowed = new Set(
                (filteredRevisions || []).map((revision) => String(revision.id)),
            )
            let changed = false
            const next: Record<string, VariantDiagnostics> = {}
            Object.entries(prev).forEach(([key, meta]) => {
                if (allowed.has(key)) {
                    next[key] = meta
                } else {
                    changed = true
                }
            })
            return changed ? next : prev
        })
    }, [filteredRevisions])

    const selectedRevisionTags = useMemo(() => {
        if (!selectedRowKeys.length) return []
        return selectedRowKeys
            .map((key) => {
                const revision = revisionById.get(String(key))
                if (!revision) return null
                return {
                    revisionId: String(key),
                    label: `${revision.variantName} - v${revision.revision}`,
                }
            })
            .filter(Boolean) as {revisionId: string; label: string}[]
    }, [selectedRowKeys, revisionById])

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
                        iconPosition="end"
                        disabled={!selectedRowKeys.length}
                        loading={variantsLoading}
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
        record: EnhancedVariant
        node: ReactNode
        onMetaChange: (id: string, meta: VariantDiagnostics) => void
    }) => {
        const revisionId = record?.id ? String(record.id) : ""
        const stableVariablesAtom = useMemo(
            () => stablePromptVariablesAtomFamily(revisionId || ""),
            [revisionId],
        )
        const variables = useAtomValue(stableVariablesAtom) as string[]

        const expectedVariables = useMemo(
            () =>
                Array.isArray(variables)
                    ? variables
                          .map((value) => (typeof value === "string" ? value.trim() : ""))
                          .filter(Boolean)
                    : [],
            [variables],
        )

        const columnsKnown = Boolean(selectedTestsetId) && normalizedTestsetColumns.length > 0

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
            Boolean(selectedTestsetId) &&
            columnsKnown &&
            expectedVariables.length > 0 &&
            missingVariables.length > 0

        const message = useMemo(() => {
            if (!selectedTestsetId || !expectedVariables.length) return undefined
            if (!columnsKnown) return "Analyzing testset columns..."
            if (missingVariables.length > 0) {
                const missingList = missingVariables.join(", ")
                return `The selected testset is missing required inputs for this variant: {{${missingList}}}`
            }
            return undefined
        }, [columnsKnown, expectedVariables.length, missingVariables, selectedTestsetId])

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
                <VariantsTable
                    variants={filteredRevisions as any}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: (value) => {
                            setSelectedRowKeys(value.map((id) => id.toString()))
                        },
                        renderCell: (_: any, record: any, __: number, originNode: ReactNode) => (
                            <SelectionCell
                                record={record as EnhancedVariant}
                                node={originNode}
                                onMetaChange={handleRowDiagnostics}
                            />
                        ),
                        type: "radio",
                    }}
                    isLoading={variantsLoading}
                    onRowClick={() => {}}
                    rowKey={"id"}
                    showStableName
                    showActionsDropdown={false}
                    rowClassName={(record) =>
                        clsx(
                            rowDiagnostics[String((record as EnhancedVariant).id)]?.hasWarning &&
                                "opacity-70",
                        )
                    }
                    onRow={(record) => {
                        const revision = record as EnhancedVariant
                        const diag = rowDiagnostics[String(revision.id)]
                        return {
                            className: "variant-table-row",
                            style: diag?.hasWarning
                                ? {cursor: "pointer", opacity: 0.7}
                                : {cursor: "pointer"},
                            title: diag?.message,
                            onClick: () => {
                                if (revision.id) {
                                    setSelectedRowKeys([String(revision.id)])
                                }
                            },
                        }
                    }}
                />
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
                tabPosition="left"
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
