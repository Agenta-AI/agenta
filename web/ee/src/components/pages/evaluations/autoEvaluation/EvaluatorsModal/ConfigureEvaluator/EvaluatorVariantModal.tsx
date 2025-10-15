import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type ComponentProps,
    type Dispatch,
    type SetStateAction,
} from "react"

import {CloseCircleOutlined, CloseOutlined} from "@ant-design/icons"
import {Play} from "@phosphor-icons/react"
import {Button, Input, Modal, Tabs, Tag, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import useAppVariantRevisions from "@/oss/lib/hooks/useAppVariantRevisions"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {JSSTheme, ListAppsItem, Variant} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app/hooks"

import TabLabel from "../../../NewEvaluation/assets/TabLabel"
import SelectAppSection from "../../../NewEvaluation/Components/SelectAppSection"
import type {NewEvaluationAppOption} from "../../../NewEvaluation/types"

import {buildVariantFromRevision} from "./variantUtils"

type EvaluatorVariantModalProps = {
    variants: Variant[] | null
    setSelectedVariant: Dispatch<SetStateAction<Variant | null>>
    selectedVariant: Variant | null
} & ComponentProps<typeof Modal>

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
                            const normalized = value.map((id) => id.toString())
                            setSelectedRowKeys(normalized)
                        },
                        type: "radio",
                    }}
                    isLoading={variantsLoading}
                    onRowClick={() => {}}
                    rowKey={"id"}
                    showStableName
                    showActionsDropdown={false}
                    onRow={(record) => {
                        const revision = record as EnhancedVariant
                        return {
                            style: {cursor: "pointer"},
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
    ])

    return (
        <Modal
            closeIcon={null}
            width={1150}
            className={classes.container}
            okText="Load variant"
            okButtonProps={{
                icon: <Play />,
                iconPosition: "end",
                disabled: !selectedRowKeys.length,
                loading: variantsLoading,
                onClick: loadVariant,
            }}
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
