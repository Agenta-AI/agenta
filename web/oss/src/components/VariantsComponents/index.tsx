// @ts-nocheck
import {useCallback, useEffect, useMemo, useState} from "react"

import {
    variantsListQueryStateAtomFamily,
    revisionsListQueryStateAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import {SwapOutlined} from "@ant-design/icons"
import {CloudArrowUpIcon, CodeSimpleIcon, LightningIcon} from "@phosphor-icons/react"
import {Button, Flex, Input, Radio, Space, Typography} from "antd"
import {atom, getDefaultStore, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import EnvironmentCardRow from "@/oss/components/DeploymentsDashboard/components/DeploymentCard/EnvironmentCardRow"
import PageLayout from "@/oss/components/PageLayout/PageLayout"
import {useAppId} from "@/oss/hooks/useAppId"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"
import {useQueryParamState} from "@/oss/state/appState"
import {deploymentRevisionsWithAppIdQueryAtomFamily} from "@/oss/state/deployment/atoms/revisions"
import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

import DeploymentsDashboard from "../DeploymentsDashboard"
import {envRevisionsAtom} from "../DeploymentsDashboard/atoms"
import {openDeploymentsDrawerAtom} from "../DeploymentsDashboard/modals/store/deploymentDrawerStore"
import DeployVariantButton from "../Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"

import {
    comparisonAllRevisionsAtom,
    comparisonSelectionScopeAtom,
    openComparisonModalAtom,
} from "./Modals/VariantComparisonModal/store/comparisonModalStore"
import {selectedVariantsCountAtom, variantTableSelectionAtomFamily} from "./store/selectionAtoms"
import VariantsTable from "./Table"

// Comparison modal is opened via atoms; no local deploy/delete modals here

const VariantsDashboard = () => {
    const appId = useAppId()
    const router = useRouter()
    const [, setQueryVariant] = useQueryParamState("revisionId")
    const [activeTab, setActiveTab] = useQueryParam("tab", "variants")
    const [selectedEnv, setSelectedEnv] = useQueryParam("selectedEnvName", "development")
    const [displayMode, setDisplayMode] = useQueryParam("displayMode", "flat")
    const [searchTerm, setSearchTerm] = useState("")
    const {baseAppURL} = useURL()
    // Data: use all revisions list and map once to table rows (no slicing)
    const emptyListAtom = useMemo(
        () => atom({data: [], isPending: false, isError: false, error: null}),
        [],
    )
    const variantsListAtom = useMemo(
        () => (appId ? variantsListQueryStateAtomFamily(appId) : emptyListAtom),
        [appId, emptyListAtom],
    )
    const variantsQuery = useAtomValue(variantsListAtom)
    const variants = variantsQuery.data ?? []
    const revisionsListAtom = useMemo(
        () =>
            atom((get) => {
                if (!appId) {
                    return {data: [], isPending: false}
                }
                const listQuery = get(variantsListQueryStateAtomFamily(appId))
                const list = listQuery.data ?? []
                let isPending = listQuery.isPending ?? false
                const revisions = list.flatMap((variant: any) => {
                    const revisionsQuery = get(revisionsListQueryStateAtomFamily(variant.id))
                    if (revisionsQuery.isPending) {
                        isPending = true
                    }
                    return revisionsQuery.data ?? []
                })
                return {data: revisions, isPending}
            }),
        [appId],
    )
    const revisionsState = useAtomValue(revisionsListAtom)
    const revisions = revisionsState.data ?? []
    const isVariantLoading = revisionsState.isPending ?? false
    const {environments, isEnvironmentsLoading} = useEnvironments({appId})

    const deploymentRevisionsAtom = useMemo(
        () => deploymentRevisionsWithAppIdQueryAtomFamily({appId, envName: selectedEnv ?? ""}),
        [appId, selectedEnv],
    )
    const {data: envRevisions} = useAtomValue(deploymentRevisionsAtom)
    const setEnvRevisions = useSetAtom(envRevisionsAtom)
    const openDeploymentsDrawer = useSetAtom(openDeploymentsDrawerAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const selectionScope = "variants/dashboard"
    const selectedRowKeys = useAtomValue(variantTableSelectionAtomFamily(selectionScope))
    const selectedRevisionId = useMemo(() => {
        const key = selectedRowKeys?.[0]
        return key ? String(key) : undefined
    }, [selectedRowKeys])

    const registryHref = useMemo(() => {
        if (!appId || !baseAppURL) return null
        return `${baseAppURL}/${appId}/variants`
    }, [appId, baseAppURL])

    const tabBreadcrumbLabel = activeTab === "deployments" ? "Deployments" : "Variants"

    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                appPage: {
                    label: "Registry",
                    ...(registryHref ? {href: registryHref} : {}),
                },
                appPageDetail: {label: tabBreadcrumbLabel},
            },
        },
        [registryHref, tabBreadcrumbLabel],
    )

    useEffect(() => {
        setEnvRevisions(envRevisions)
    }, [envRevisions, setEnvRevisions])

    useEffect(() => {
        recordWidgetEvent("registry_page_viewed")
    }, [recordWidgetEvent])

    const variantNameMap = useMemo(() => {
        const map: Record<string, string> = {}
        variants.forEach((variant: any) => {
            if (!variant?.id) return
            map[variant.id] = (variant.name as string) || (variant.baseName as string) || variant.id
        })
        return map
    }, [variants])

    const baseRows = useMemo(() => {
        return (revisions || [])
            .map((r: any) => {
                if (Number(r?.revision ?? 0) <= 0) return null
                const timestamp = r.createdAt ? new Date(r.createdAt).valueOf() : Date.now()
                const params = r.parameters || {}
                const llmConfig = (params as any)?.prompt?.llm_config || params
                const modelName =
                    (typeof llmConfig?.model === "string" && llmConfig.model.trim()) || undefined
                const variantName = variantNameMap[r.variantId] ?? "-"
                return {
                    id: r.id,
                    variantId: r.variantId,
                    variantName,
                    commitMessage: r.commitMessage ?? r.commit_message ?? null,
                    createdAt: formatDate24(timestamp),
                    createdAtTimestamp: timestamp,
                    updatedAtTimestamp: timestamp,
                    modifiedBy: r.author ?? r.modifiedBy ?? r.modified_by ?? null,
                    modelName,
                    _revisionId: r.id,
                }
            })
            .filter(Boolean)
    }, [revisions, variantNameMap])

    const filteredRows = useMemo(() => {
        if (!searchTerm) return baseRows
        const q = searchTerm.toLowerCase()
        return baseRows.filter((r: any) => (r.variantName || "").toLowerCase().includes(q))
    }, [baseRows, searchTerm])

    const tableRows = useMemo(() => {
        if (displayMode !== "grouped") {
            return [...filteredRows].sort(
                (a: any, b: any) => (b.createdAtTimestamp || 0) - (a.createdAtTimestamp || 0),
            )
        }
        // Group revisions by variantId; parent row uses latest revision id
        const byVariant: Record<string, any[]> = {}
        filteredRows.forEach((r: any) => {
            ;(byVariant[r.variantId] ||= []).push(r)
        })
        const groups: any[] = []
        Object.values(byVariant).forEach((arr) => {
            const sorted = [...arr].sort(
                (a, b) => (b.createdAtTimestamp || 0) - (a.createdAtTimestamp || 0),
            )
            const latest = sorted[0]
            const children = sorted.slice(1)
            groups.push({
                ...latest,
                _isParentRow: true,
                children,
            })
        })
        // Sort variant groups by latest revision timestamp (newest first)
        groups.sort((a, b) => (b.createdAtTimestamp || 0) - (a.createdAtTimestamp || 0))
        return groups
    }, [filteredRows, displayMode])

    // Selection/compare using global atoms with a stable scope
    const selectedCount = useAtomValue(selectedVariantsCountAtom(selectionScope))
    const openComparisonModal = useSetAtom(openComparisonModalAtom)
    const setComparisonSelectionScope = useSetAtom(comparisonSelectionScopeAtom)
    const setComparisonAllRevisions = useSetAtom(comparisonAllRevisionsAtom)
    const {goToPlayground} = usePlaygroundNavigation()
    const prefetchPlayground = useCallback(async () => {
        if (appId) {
            router.prefetch(`${baseAppURL}/${appId}/playground`).catch(() => {})
        }
    }, [appId, baseAppURL, router])

    const handleNavigation = useCallback(
        async (record?: any) => {
            // Try to prefetch chunks before navigating for a seamless transition
            prefetchPlayground()
            // Prewarm prompts for the selected revision specifically
            const store = getDefaultStore()
            const revId = record?._revisionId ?? record?.id
            if (revId) {
                store.get(moleculeBackedPromptsAtomFamily(revId))
            }
            if (revId) {
                goToPlayground(revId)
            } else {
                goToPlayground()
            }
        },
        [goToPlayground, prefetchPlayground],
    )

    const handleOpenDetails = useCallback(
        (record: any) => {
            const revId = record._revisionId ?? record.id
            if (!revId) return
            // Shallow URL patch lets the route listener atom open the drawer
            setQueryVariant(revId, {shallow: true})
        },
        [setQueryVariant],
    )

    const tabItems = useMemo(
        () => [
            {
                key: "variants",
                label: (
                    <span className="inline-flex items-center gap-2">
                        <LightningIcon />
                        Variants
                    </span>
                ),
            },
            {
                key: "deployments",
                label: (
                    <span className="inline-flex items-center gap-2">
                        <CloudArrowUpIcon />
                        Deployments
                    </span>
                ),
            },
        ],
        [],
    )
    const headerTabsProps = useMemo(
        () => ({
            items: tabItems,
            activeKey: activeTab,
            onChange: (key: string) => setActiveTab(key),
        }),
        [activeTab, setActiveTab, tabItems],
    )

    const variantContent = (
        <Space direction="vertical" className="w-full">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1">
                    <Input.Search
                        placeholder="Search"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="md:max-w-[300px] lg:max-w-[400px] lg:w-[400px]"
                        allowClear
                    />
                    <Radio.Group
                        value={displayMode}
                        onChange={(e) => setDisplayMode(e.target.value)}
                        className="flex-shrink-0"
                    >
                        <Radio.Button value="grouped">Variants</Radio.Button>
                        <Radio.Button value="flat">Revisions</Radio.Button>
                    </Radio.Group>
                </div>

                <div className="flex items-center gap-3">
                    {selectedCount > 0 && (
                        <Typography.Text type="secondary" className="flex-shrink-0">
                            {selectedCount} selected
                        </Typography.Text>
                    )}

                    <Button
                        type="link"
                        disabled={selectedCount !== 2}
                        icon={<SwapOutlined />}
                        onClick={() => {
                            setComparisonAllRevisions(baseRows as any)
                            setComparisonSelectionScope(selectionScope)
                            openComparisonModal()
                        }}
                    >
                        Compare
                    </Button>

                    <DeployVariantButton
                        type="default"
                        label="Deploy"
                        disabled={!selectedRevisionId || selectedCount > 1}
                        revisionId={selectedRevisionId}
                    />

                    <Button
                        type="primary"
                        disabled={!envRevisions}
                        icon={<CodeSimpleIcon size={14} />}
                        data-tour="api-code-button"
                        onClick={() => {
                            openDeploymentsDrawer({
                                initialWidth: 1200,
                                revisionId: selectedRevisionId,
                                mode: "variant",
                            })
                            recordWidgetEvent("integration_snippet_viewed")
                        }}
                    >
                        Use API
                    </Button>
                </div>
            </div>

            <VariantsTable
                enableColumnResize
                showEnvBadges
                showStableName
                variants={tableRows}
                isLoading={isVariantLoading}
                selectionScope={selectionScope}
                onRowClick={handleOpenDetails}
                handleOpenDetails={handleOpenDetails}
                handleOpenInPlayground={(record) => handleNavigation(record)}
            />
        </Space>
    )

    const deploymentsContent = (
        <div className="flex flex-col gap-4">
            <Flex align="center" gap={16}>
                <EnvironmentCardRow
                    environments={environments}
                    isLoading={isEnvironmentsLoading}
                    selectedEnvName={selectedEnv}
                    onCardClick={(env) => setSelectedEnv(env.name)}
                />
            </Flex>

            <DeploymentsDashboard
                selectedEnvName={selectedEnv || ""}
                envRevisions={envRevisions}
                isLoading={isEnvironmentsLoading}
            />
        </div>
    )

    return (
        <PageLayout title="Registry" headerTabsProps={headerTabsProps} className="grow min-h-0">
            {activeTab === "deployments" ? deploymentsContent : variantContent}
        </PageLayout>
    )
}

export default VariantsDashboard
