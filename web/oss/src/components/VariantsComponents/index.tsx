import {useCallback, useEffect, useMemo} from "react"

import {environmentsListQueryAtomFamily} from "@agenta/entities/environment"
import type {Environment as EntityEnvironment} from "@agenta/entities/environment"
import {workflowRevisionDrawerNavigationIdsAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {PageLayout} from "@agenta/ui"
import {SwapOutlined} from "@ant-design/icons"
import {CloudArrowUpIcon, CodeSimpleIcon, LightningIcon} from "@phosphor-icons/react"
import {Button, Flex, Input, Radio, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import EnvironmentCardRow from "@/oss/components/DeploymentsDashboard/components/DeploymentCard/EnvironmentCardRow"
import {selectedEnvironmentIdAtom} from "@/oss/components/DeploymentsDashboard/store/deploymentFilterAtoms"
import {useAppId} from "@/oss/hooks/useAppId"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {useQueryParamState} from "@/oss/state/appState"
import {useAppEnvironments} from "@/oss/state/environment/useAppEnvironments"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

import {openDeploymentsDrawerAtom} from "../DeploymentsDashboard/modals/store/deploymentDrawerStore"
import {openDeleteVariantModalAtom} from "../Playground/Components/Modals/DeleteVariantModal/store/deleteVariantModalStore"
import DeployVariantButton from "../Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
import {openDeployVariantModalAtom} from "../Playground/Components/Modals/DeployVariantModal/store/deployVariantModalStore"

import {
    comparisonSelectionScopeAtom,
    openComparisonModalAtom,
} from "./Modals/VariantComparisonModal/store/comparisonModalStore"
import {registrySearchTermAtom, registryDisplayModeAtom} from "./store/registryFilterAtoms"
import {registryPaginatedStore, type RegistryRevisionRow} from "./store/registryStore"
import type {RegistryColumnActions} from "./Table/assets/registryColumns"
import RegistryTable from "./Table/RegistryTable"

const DeploymentsDashboard = dynamic(() => import("../DeploymentsDashboard"), {ssr: false})

const SCOPE_ID = "registry-revisions"
const CONTROLLER_PARAMS = {scopeId: SCOPE_ID, pageSize: 50}

const VariantsDashboard = () => {
    const appId = useAppId()
    const router = useRouter()
    const [, setQueryVariant] = useQueryParamState("revisionId")
    const [activeTab, setActiveTab] = useQueryParam("tab", "variants")
    const [selectedEnv, setSelectedEnv] = useQueryParam("selectedEnvName", "development")
    const [displayMode, setDisplayMode] = useAtom(registryDisplayModeAtom)
    const [searchTerm, setSearchTerm] = useAtom(registrySearchTermAtom)
    const {baseAppURL} = useURL()

    // Phase 6.2: gate deploy-related UI on workflow kind. Evaluators don't
    // deploy to environments — hide the per-row "Deploy" action and the
    // header-level Deploy button. The deployments tab is also hidden / URL-
    // rewritten in this phase (see tabItems below + the redirect effect).
    const workflowCtx = useAtomValue(currentWorkflowContextAtom)
    const isCurrentWorkflowEvaluator = workflowCtx.workflowKind === "evaluator"

    // Deployments data
    const {environments, isEnvironmentsLoading} = useAppEnvironments({appId})
    const setSelectedEnvironmentId = useSetAtom(selectedEnvironmentIdAtom)
    const openDeploymentsDrawer = useSetAtom(openDeploymentsDrawerAtom)

    // Resolve selected environment name → entity ID from the entity list query
    const entityEnvironments = useAtomValue(environmentsListQueryAtomFamily(false))
    const selectedEnvironmentEntity = useMemo<EntityEnvironment | null>(() => {
        if (!selectedEnv) return null
        const envs = entityEnvironments.data?.environments ?? []
        return (
            envs.find(
                (e) =>
                    e.name === selectedEnv ||
                    e.slug === selectedEnv ||
                    e.name?.toLowerCase() === selectedEnv.toLowerCase(),
            ) ?? null
        )
    }, [selectedEnv, entityEnvironments.data])

    const selectedEnvironmentId = selectedEnvironmentEntity?.id ?? null

    // Extract the currently deployed revision ID for the selected environment and current app
    const currentDeployedRevisionId = useMemo(() => {
        if (!selectedEnvironmentEntity?.data?.references || !appId) return null
        const refs = selectedEnvironmentEntity.data.references as Record<
            string,
            {application?: {id?: string}; application_revision?: {id?: string}}
        >
        // Find the reference matching the current app by ID
        for (const ref of Object.values(refs)) {
            if (ref?.application?.id === appId) {
                return ref.application_revision?.id ?? null
            }
        }
        return null
    }, [selectedEnvironmentEntity, appId])
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    // Selection from paginated store
    const selectionAtom = useMemo(
        () => registryPaginatedStore.selectors.selection(CONTROLLER_PARAMS),
        [],
    )
    const selectedRowKeys = useAtomValue(selectionAtom)
    const selectedCount = selectedRowKeys.length
    const selectedRevisionId = useMemo(() => {
        const key = selectedRowKeys?.[0]
        return key ? String(key) : undefined
    }, [selectedRowKeys])

    // Comparison modal atoms
    const openComparisonModal = useSetAtom(openComparisonModalAtom)
    const setComparisonSelectionScope = useSetAtom(comparisonSelectionScopeAtom)

    // Delete / Deploy modal atoms
    const openDeleteVariantModal = useSetAtom(openDeleteVariantModalAtom)
    const openDeployVariantModal = useSetAtom(openDeployVariantModalAtom)

    // Navigation
    const {goToPlayground} = usePlaygroundNavigation()
    const prefetchPlayground = useCallback(async () => {
        if (appId) {
            router.prefetch(`${baseAppURL}/${appId}/playground`).catch(() => {})
        }
    }, [appId, baseAppURL, router])

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

    // Sync selected environment ID to the deployment store's filter atom
    useEffect(() => {
        setSelectedEnvironmentId(selectedEnvironmentId)
    }, [selectedEnvironmentId, setSelectedEnvironmentId])

    useEffect(() => {
        recordWidgetEvent("registry_page_viewed")
    }, [recordWidgetEvent])

    // Navigation: keep drawer prev/next list in sync with visible table rows.
    // Uses an effect so navigation works even when the drawer is opened via URL.
    const tableState = useAtomValue(registryPaginatedStore.selectors.state(CONTROLLER_PARAMS))
    const setNavigationIds = useSetAtom(workflowRevisionDrawerNavigationIdsAtom)

    useEffect(() => {
        const navIds = tableState.rows
            .map((r) => r.revisionId)
            .filter((id): id is string => Boolean(id))
        if (navIds.length > 0) {
            setNavigationIds(navIds)
        }
    }, [tableState.rows, setNavigationIds])

    // Handlers
    const handleOpenDetails = useCallback(
        (record: RegistryRevisionRow) => {
            const revId = record.revisionId
            if (!revId) return
            setQueryVariant(revId, {shallow: true})
        },
        [setQueryVariant],
    )

    const handleOpenInPlayground = useCallback(
        (record: RegistryRevisionRow) => {
            prefetchPlayground()
            const revId = record.revisionId
            if (revId) {
                goToPlayground(revId)
            } else {
                goToPlayground()
            }
        },
        [goToPlayground, prefetchPlayground],
    )

    const handleDeploy = useCallback(
        (record: RegistryRevisionRow) => {
            openDeployVariantModal({
                parentVariantId: null,
                revisionId: record.revisionId,
                variantName: record.variantName,
                revision: record.version ?? 0,
            })
        },
        [openDeployVariantModal],
    )

    const handleDelete = useCallback(
        (record: RegistryRevisionRow) => {
            const isVariantGroup = !!(record as Record<string, unknown>).__isVariantGroup
            openDeleteVariantModal({
                revisionIds: [record.revisionId],
                forceVariantIds: isVariantGroup ? [record.variantId] : [],
                workflowId: record.workflowId,
            })
        },
        [openDeleteVariantModal],
    )

    const columnActions = useMemo<RegistryColumnActions>(
        () => ({
            handleOpenDetails,
            handleOpenInPlayground,
            handleDeploy,
            handleDelete,
        }),
        [handleOpenDetails, handleOpenInPlayground, handleDeploy, handleDelete],
    )

    // Tab items. Phase 6.2: hide the Deployments tab when current workflow
    // is an evaluator (evaluators don't deploy). Stale-bookmark rewrite
    // handled by the effect below this useMemo.
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
            ...(isCurrentWorkflowEvaluator
                ? []
                : [
                      {
                          key: "deployments",
                          label: (
                              <span className="inline-flex items-center gap-2">
                                  <CloudArrowUpIcon />
                                  Deployments
                              </span>
                          ),
                      },
                  ]),
        ],
        [isCurrentWorkflowEvaluator],
    )

    // Phase 6.2: stale-bookmark URL rewrite. If the user lands on
    // /apps/[evaluator_id]/variants?tab=deployments, flip them to the default
    // tab. The deployments tab itself is already hidden above; this handles
    // the URL-direct case.
    useEffect(() => {
        if (isCurrentWorkflowEvaluator && activeTab === "deployments") {
            setActiveTab("variants")
        }
    }, [isCurrentWorkflowEvaluator, activeTab, setActiveTab])
    const headerTabsProps = useMemo(
        () => ({
            items: tabItems,
            activeKey: activeTab,
            onChange: (key: string) => setActiveTab(key),
        }),
        [activeTab, setActiveTab, tabItems],
    )

    const filtersNode = useMemo(
        () => (
            <div className="flex gap-2 flex-1 items-center">
                <Input.Search
                    placeholder="Search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-[320px]"
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
        ),
        [searchTerm, setSearchTerm, displayMode, setDisplayMode],
    )

    const actionsNode = useMemo(
        () => (
            <div className="flex items-center gap-2">
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
                        setComparisonSelectionScope(SCOPE_ID)
                        openComparisonModal()
                    }}
                >
                    Compare
                </Button>
                {!isCurrentWorkflowEvaluator && (
                    <DeployVariantButton
                        type="default"
                        label="Deploy"
                        disabled={!selectedRevisionId || selectedCount > 1}
                        revisionId={selectedRevisionId}
                    />
                )}
                <Button
                    type="primary"
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
        ),
        [
            selectedCount,
            selectedRevisionId,
            setComparisonSelectionScope,
            openComparisonModal,
            openDeploymentsDrawer,
            recordWidgetEvent,
        ],
    )

    const variantContent = (
        <div className="flex flex-col h-full min-h-0 grow">
            <RegistryTable
                onRowClick={handleOpenDetails}
                actions={columnActions}
                searchDeps={[searchTerm]}
                filters={filtersNode}
                primaryActions={actionsNode}
                displayMode={displayMode}
                hideDeployActions={isCurrentWorkflowEvaluator}
            />
        </div>
    )

    const deploymentsContent = (
        <div className="flex flex-col gap-4 h-full min-h-0 grow">
            <Flex align="center" gap={16} className="flex-shrink-0">
                <EnvironmentCardRow
                    environments={environments}
                    isLoading={isEnvironmentsLoading}
                    selectedEnvName={selectedEnv}
                    onCardClick={(env) => setSelectedEnv(env.name)}
                />
            </Flex>

            <DeploymentsDashboard
                environmentId={selectedEnvironmentId}
                environmentName={selectedEnv || ""}
                currentDeployedRevisionId={currentDeployedRevisionId}
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
