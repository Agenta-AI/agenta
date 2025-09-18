import {type FC, useEffect, useMemo, type SetStateAction, useCallback, useRef} from "react"

import {CloudArrowUp} from "@phosphor-icons/react"
import {Button, Flex, Input, Space, Typography, message} from "antd"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {DeploymentRevisions} from "@/oss/lib/Types"
import {JSSTheme} from "@/oss/lib/Types"
import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"

import {revisionListAtom} from "../Playground/state/atoms"
import {
    openVariantDrawerAtom,
    drawerVariantIdAtom,
} from "../VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"

import UseApiContent from "./assets/UseApiContent"
import {
    deploymentSearchAtom,
    selectedDeploymentRowKeysAtom,
    deploymentNoteAtom,
    selectedRevisionRowAtom,
    selectedVariantRevisionIdToRevertAtom,
    envRevisionsAtom,
    deploymentModalsAtom,
    filteredDeploymentRevisionsAtom,
    selectedVariantToDeployAtom,
    selectedVariantToRevertAtom,
} from "./atoms"
import DeploymentsDrawer from "./components/Drawer"
import DeploymentConfirmationModal from "./components/Modal/DeploymentConfirmationModal"
import SelectDeployVariantModal from "./components/Modal/SelectDeployVariantModal"
import DeploymentTable from "./components/Table"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
        textTransform: "capitalize",
    },
    subTitle: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
}))

interface DeploymentsDashboardProps {
    envRevisions: DeploymentRevisions | undefined
    isLoading: boolean
}

const DeploymentsDashboard: FC<DeploymentsDashboardProps> = ({envRevisions, isLoading}) => {
    const appId = useAppId()
    const router = useRouter()
    const {isPending: isPublishing, mutateAsync: publish} = useAtomValue(publishMutationAtom)
    const classes = useStyles()

    // Sync envRevisions prop with atom
    const setEnvRevisions = useSetAtom(envRevisionsAtom)
    useEffect(() => {
        setEnvRevisions(envRevisions)
    }, [envRevisions, setEnvRevisions])

    // Atom-based drawer control
    const openVariantDrawer = useSetAtom(openVariantDrawerAtom)
    const setDrawerVariantId = useSetAtom(drawerVariantIdAtom)

    // Create a custom variants atom for this component (needed for drawer)
    const variants = useAtomValue(revisionListAtom) || []
    const customVariantsAtom = useMemo(() => atom(variants || []), [variants])

    // Optimized state management with atoms
    const [searchTerm, setSearchTerm] = useAtom(deploymentSearchAtom)
    const [note, setNote] = useAtom(deploymentNoteAtom)

    // Keep some local state for now to avoid breaking existing functionality
    const [selectedRowKeys, setSelectedRowKeys] = useAtom(selectedDeploymentRowKeysAtom)
    const [selectedRevisionRow, setSelectedRevisionRow] = useAtom(selectedRevisionRowAtom)
    const [selectedVariantRevisionIdToRevert, setSelectedVariantRevisionIdToRevert] = useAtom(
        selectedVariantRevisionIdToRevertAtom,
    )

    // Modal states - using atoms for better optimization
    const [modals, setModals] = useAtom(deploymentModalsAtom)

    // Modal state getters/setters for compatibility
    const isDeployVariantModalOpen = modals.isDeployVariantModalOpen
    const setIsDeployVariantModalOpen = (isOpen: SetStateAction<boolean>) => {
        const newValue =
            typeof isOpen === "function" ? isOpen(modals.isDeployVariantModalOpen) : isOpen
        setModals((prev) => ({...prev, isDeployVariantModalOpen: newValue}))
    }

    const isSelectDeployVariantModalOpen = modals.isSelectDeployVariantModalOpen
    const setIsSelectDeployVariantModalOpen = (isOpen: SetStateAction<boolean>) => {
        const newValue =
            typeof isOpen === "function" ? isOpen(modals.isSelectDeployVariantModalOpen) : isOpen
        setModals((prev) => ({...prev, isSelectDeployVariantModalOpen: newValue}))
    }

    const isRevertModalOpen = modals.isRevertModalOpen
    const setIsRevertModalOpen = (isOpen: SetStateAction<boolean>) => {
        const newValue = typeof isOpen === "function" ? isOpen(modals.isRevertModalOpen) : isOpen
        setModals((prev) => ({...prev, isRevertModalOpen: newValue}))
    }

    const isUseApiDrawerOpen = modals.isUseApiDrawerOpen
    const setIsUseApiDrawerOpen = (isOpen: SetStateAction<boolean>) => {
        const newValue = typeof isOpen === "function" ? isOpen(modals.isUseApiDrawerOpen) : isOpen
        setModals((prev) => ({...prev, isUseApiDrawerOpen: newValue}))
    }

    const setIsRevisionsDetailsDrawerOpen = (isOpen: SetStateAction<boolean>) => {
        const newValue =
            typeof isOpen === "function" ? isOpen(modals.isRevisionsDetailsDrawerOpen) : isOpen
        setModals((prev) => ({...prev, isRevisionsDetailsDrawerOpen: newValue}))
    }

    // URL parameter for drawer control
    const [queryVariant] = useQueryParam("revisions")

    // Atom-based computed values
    const selectedVariantToDeploy = useAtomValue(selectedVariantToDeployAtom)
    const selectedVariantToRevert = useAtomValue(selectedVariantToRevertAtom)
    const revisions = useAtomValue(filteredDeploymentRevisionsAtom)

    // Open drawer once on initial load if URL contains revisions (deep link)
    const hasInitFromUrlRef = useRef(false)
    useEffect(() => {
        const isPlaygroundRoute = router.pathname.includes("/playground")
        if (isPlaygroundRoute) return
        if (hasInitFromUrlRef.current) return
        if (!queryVariant) return
        try {
            const targetId = JSON.parse(String(queryVariant))?.[0]
            if (targetId && typeof targetId === "string") {
                setDrawerVariantId(targetId)
                openVariantDrawer({
                    type: "deployment",
                    variantsAtom: customVariantsAtom,
                    revert: {
                        isDisabled:
                            selectedRevisionRow?.deployed_app_variant_revision ===
                            envRevisions?.deployed_app_variant_revision_id,
                        onClick: () => setIsRevertModalOpen(true),
                        isLoading: isPublishing,
                    },
                })
                hasInitFromUrlRef.current = true
            }
        } catch {
            // ignore
        }
    }, [
        router.pathname,
        queryVariant,
        setDrawerVariantId,
        openVariantDrawer,
        customVariantsAtom,
        selectedRevisionRow,
        envRevisions,
        isPublishing,
        setIsRevertModalOpen,
    ])

    const handleDeployVariant = useCallback(async () => {
        const revisionId = selectedRowKeys[0] as string
        try {
            await publish({
                type: "revision",
                note,
                revision_id: revisionId,
                environment_ref: envRevisions?.name || "",
                // Metadata for centralized success messaging and analytics
                variantName: selectedVariantToDeploy?.variantName,
                appId,
                deploymentType: "deploy",
            })
            // No need to manually refetch - the mutation atom handles query invalidation
            // Success message and analytics are now handled by the mutation atom
        } catch (error) {
            console.error("Error deploying variant:", error)
            message.error("Failed to deploy variant. Please try again.")
        } finally {
            // Clean up UI state
            setNote("")
            setIsDeployVariantModalOpen(false)
            setSelectedRowKeys([])
            setIsSelectDeployVariantModalOpen(false)
        }
    }, [
        publish,
        selectedVariantToDeploy,
        selectedRowKeys,
        note,
        setIsDeployVariantModalOpen,
        setIsSelectDeployVariantModalOpen,
    ])

    const handleRevertDeployment = useCallback(async () => {
        try {
            await publish({
                type: "revision",
                note,
                revision_id: selectedVariantRevisionIdToRevert,
                environment_ref: envRevisions?.name || "",
                // Metadata for centralized success messaging and analytics
                variantName: selectedVariantToRevert?.variantName,
                appId,
                deploymentType: "revert",
            })
            // No need to manually refetch - the mutation atom handles query invalidation
            // Success message and analytics are now handled by the mutation atom
        } catch (error) {
            console.error("Error reverting deployment:", error)
            message.error("Failed to revert deployment. Please try again.")
        } finally {
            // Clean up UI state
            setNote("")
            setIsRevertModalOpen(false)
            setSelectedVariantRevisionIdToRevert("")
            setIsRevisionsDetailsDrawerOpen(false)
        }
    }, [
        publish,
        selectedVariantRevisionIdToRevert,
        note,
        setIsRevertModalOpen,
        setIsRevisionsDetailsDrawerOpen,
    ])

    return (
        <>
            <Space direction="vertical" size={24}>
                <Flex align="center" justify="space-between">
                    <Typography.Text className={classes.title}>
                        {envRevisions?.name}
                    </Typography.Text>
                    <Space>
                        <Button
                            icon={<CloudArrowUp />}
                            onClick={() => setIsSelectDeployVariantModalOpen(true)}
                        >
                            Deploy variant
                        </Button>
                        <Button type="primary" onClick={() => setIsUseApiDrawerOpen(true)}>
                            Use API
                        </Button>
                    </Space>
                </Flex>

                <div className="flex flex-col gap-2">
                    <div>
                        <Input.Search
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search"
                            allowClear
                            className="w-[400px]"
                        />
                    </div>

                    <DeploymentTable
                        revisions={revisions}
                        setSelectedRevisionRow={setSelectedRevisionRow}
                        setIsRevertModalOpen={setIsRevertModalOpen}
                        setSelectedVariantRevisionIdToRevert={setSelectedVariantRevisionIdToRevert}
                        envRevisions={envRevisions}
                        setIsSelectDeployVariantModalOpen={setIsSelectDeployVariantModalOpen}
                        isLoading={isLoading}
                        onOpenDrawer={(targetId) => {
                            if (!targetId) return
                            setDrawerVariantId(targetId)
                            openVariantDrawer({
                                type: "deployment",
                                variantsAtom: customVariantsAtom,
                                revert: {
                                    isDisabled:
                                        selectedRevisionRow?.deployed_app_variant_revision ===
                                        envRevisions?.deployed_app_variant_revision_id,
                                    onClick: () => setIsRevertModalOpen(true),
                                    isLoading: isPublishing,
                                },
                            })
                        }}
                    />
                </div>
            </Space>

            {/* Use API Drawer */}
            {envRevisions && (
                <DeploymentsDrawer
                    mainContent={
                        <UseApiContent
                            handleOpenSelectDeployVariantModal={() => {
                                setIsUseApiDrawerOpen(false)
                                setIsSelectDeployVariantModalOpen(true)
                            }}
                            variants={variants}
                            selectedEnvironment={envRevisions}
                        />
                    }
                    headerContent={
                        <Typography.Text className={classes.subTitle}>
                            How to use API
                        </Typography.Text>
                    }
                    open={isUseApiDrawerOpen}
                    onClose={() => setIsUseApiDrawerOpen(false)}
                    initialWidth={720}
                />
            )}

            {/* Select Deploy Variant Modal */}
            <SelectDeployVariantModal
                variants={variants}
                envRevisions={envRevisions}
                setIsDeployVariantModalOpen={setIsDeployVariantModalOpen}
                open={isSelectDeployVariantModalOpen}
                onCancel={() => {
                    setSelectedRowKeys([])
                    setIsSelectDeployVariantModalOpen(false)
                }}
                setSelectedRowKeys={setSelectedRowKeys}
                selectedRowKeys={selectedRowKeys}
            />

            {/* Deploy Variant Modal */}
            {selectedVariantToDeploy && (
                <DeploymentConfirmationModal
                    open={isDeployVariantModalOpen}
                    onCancel={() => {
                        setNote("")
                        setIsDeployVariantModalOpen(false)
                    }}
                    okButtonProps={{loading: isPublishing}}
                    onOk={handleDeployVariant}
                    note={note}
                    setNote={setNote}
                    variant={selectedVariantToDeploy}
                    envName={envRevisions?.name || ""}
                />
            )}

            {/* Revert Deployment Modal */}
            <DeploymentConfirmationModal
                open={isRevertModalOpen}
                onCancel={() => {
                    setNote("")
                    setIsRevertModalOpen(false)
                    setSelectedVariantRevisionIdToRevert("")
                }}
                onOk={handleRevertDeployment}
                okButtonProps={{loading: isPublishing}}
                note={note}
                setNote={setNote}
                envName={envRevisions?.name || ""}
                displayNote={false}
                variant={selectedVariantToRevert}
                actionType="revert"
            />
        </>
    )
}

export default DeploymentsDashboard
