import {type ReactElement, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {FloppyDiskBack} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {Resizable} from "react-resizable"

import {message} from "@/oss/components/AppMessageContext"
import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {
    revisionListAtom,
    saveVariantMutationAtom,
    selectedVariantsAtom,
} from "@/oss/components/Playground/state/atoms"
import {isVariantNameInputValid} from "@/oss/lib/helpers/utils"
import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"

import {createVariantMutationAtom} from "../../../state/atoms/variantCrudMutations"

import {CommitVariantChangesModalProps, SelectedCommitType} from "./assets/types"
const CommitVariantChangesModalContent = dynamic(
    () => import("./assets/CommitVariantChangesModalContent"),
    {ssr: false},
)

const CommitVariantChangesModal: React.FC<CommitVariantChangesModalProps> = ({
    variantId,
    onSuccess,
    commitType,
    ...props
}) => {
    const {onCancel, ...modalProps} = props
    // Get variant metadata from revision list
    const revisions = useAtomValue(revisionListAtom)
    const variant = revisions?.find((rev: any) => rev.id === variantId)

    // Extract values from variant
    const variantName = variant?.variantName

    // Get mutation functions
    const saveVariant = useSetAtom(saveVariantMutationAtom)
    const createVariant = useSetAtom(createVariantMutationAtom)
    const {isPending: isPublishing, mutateAsync: publish} = useAtomValue(publishMutationAtom)

    // Track loading state for mutations
    const [isMutating, setIsMutating] = useState(false)
    // Wait for state to settle before closing
    const [waitForRevisionId, setWaitForRevisionId] = useState<string | undefined>(undefined)

    const [selectedCommitType, setSelectedCommitType] = useState<SelectedCommitType>({
        type: "version",
    })
    const [note, setNote] = useState("")
    const [shouldDeploy, setShouldDeploy] = useState(false)
    const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(null)
    const [modalSize, setModalSize] = useState({width: 960, height: 640})
    const [viewport, setViewport] = useState({width: 0, height: 0})
    const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const SETTLE_TIMEOUT_MS = 1500

    const onClose = useCallback(() => {
        onCancel?.({} as any)
        setIsMutating(false)
        setWaitForRevisionId(undefined)
        if (settleTimeoutRef.current) {
            clearTimeout(settleTimeoutRef.current)
            settleTimeoutRef.current = null
        }
        setSelectedCommitType({
            type: "version",
        })
        setNote("")
        setShouldDeploy(false)
        setSelectedEnvironment(null)
    }, [onCancel])

    // Observe current selected revision(s) to know when state settles
    const selectedRevisionIds = useAtomValue(selectedVariantsAtom)

    // Track viewport to clamp the resizable modal
    useEffect(() => {
        if (typeof window === "undefined") return
        const updateViewport = () =>
            setViewport({width: window.innerWidth, height: window.innerHeight})
        updateViewport()
        window.addEventListener("resize", updateViewport)
        return () => window.removeEventListener("resize", updateViewport)
    }, [])

    const computedMaxWidth = useMemo(() => {
        if (!viewport.width) return 960
        return Math.min(Math.max(viewport.width - 48, 480), 1200)
    }, [viewport.width])

    const computedMaxHeight = useMemo(() => {
        if (!viewport.height) return 640
        return Math.min(Math.max(viewport.height - 160, 400), 900)
    }, [viewport.height])

    const minConstraints = useMemo(() => {
        return [Math.min(720, computedMaxWidth), Math.min(480, computedMaxHeight)] as [
            number,
            number,
        ]
    }, [computedMaxWidth, computedMaxHeight])

    const maxConstraints = useMemo(() => {
        return [computedMaxWidth, computedMaxHeight] as [number, number]
    }, [computedMaxWidth, computedMaxHeight])

    useEffect(() => {
        if (!viewport.width || !viewport.height) return
        setModalSize((previous) => ({
            width: Math.min(Math.max(previous.width, minConstraints[0]), computedMaxWidth),
            height: Math.min(Math.max(previous.height, minConstraints[1]), computedMaxHeight),
        }))
    }, [viewport, minConstraints, computedMaxWidth, computedMaxHeight])

    // Close when the state settles with the new revision
    useEffect(() => {
        if (!waitForRevisionId) return

        // Wait for the state to reflect the new revision
        if (selectedRevisionIds?.includes(waitForRevisionId)) {
            if (settleTimeoutRef.current) {
                clearTimeout(settleTimeoutRef.current)
                settleTimeoutRef.current = null
            }
            onClose()
        }
    }, [selectedRevisionIds, waitForRevisionId, onClose])

    useEffect(() => {
        return () => {
            if (settleTimeoutRef.current) {
                clearTimeout(settleTimeoutRef.current)
                settleTimeoutRef.current = null
            }
        }
    }, [])

    const startSettleWait = useCallback(
        (nextRevisionId: string) => {
            if (!nextRevisionId) return
            setWaitForRevisionId(nextRevisionId)
            if (settleTimeoutRef.current) {
                clearTimeout(settleTimeoutRef.current)
            }
            settleTimeoutRef.current = setTimeout(() => {
                settleTimeoutRef.current = null
                onClose()
            }, SETTLE_TIMEOUT_MS)
        },
        [onClose],
    )

    const handleDeployAfterCommit = useCallback(
        async (resultVariant?: any) => {
            if (!shouldDeploy || !selectedEnvironment) {
                return
            }

            try {
                const variantIdForDeployment =
                    resultVariant?.variant_id || resultVariant?.variantId || variant?.variantId

                const revisionIdForDeployment =
                    resultVariant?.id ||
                    resultVariant?.revision_id ||
                    waitForRevisionId ||
                    variantId

                if (!variantIdForDeployment) {
                    message.error("Unable to deploy because the variant identifier is missing.")
                    return
                }

                await publish({
                    type: "variant",
                    variant_id: variantIdForDeployment,
                    revision_id: revisionIdForDeployment ?? undefined,
                    environment_name: selectedEnvironment,
                    note,
                })

                message.success(`Deployment to ${selectedEnvironment} started`)
            } catch (error) {
                console.error("Failed to deploy after commit", error)
                message.error("Failed to deploy to the selected environment.")
            }
        },
        [shouldDeploy, selectedEnvironment, publish, note, variant, variantId, waitForRevisionId],
    )

    const onSaveVariantChanges = useCallback(async () => {
        try {
            setIsMutating(true)

            if (selectedCommitType?.type === "version") {
                const result = await saveVariant?.({
                    variantId,
                    note,
                    commitType,
                })

                if (result?.success) {
                    onSuccess?.({
                        revisionId: result.variant?.id,
                        variantId: result.variant?.variantId,
                    })

                    await handleDeployAfterCommit(result.variant)

                    // Wait for the state to settle with the new revision
                    const nextRevisionId = result.variant?.id
                    const isAlreadySelected =
                        nextRevisionId && selectedRevisionIds?.includes(nextRevisionId)
                    const wasSelected = selectedRevisionIds?.includes(variantId)
                    if (nextRevisionId && wasSelected && !isAlreadySelected) {
                        startSettleWait(nextRevisionId)
                        return // Let selection settle or timeout close
                    }
                }
            } else if (selectedCommitType?.type === "variant" && selectedCommitType?.name) {
                const result = await createVariant?.({
                    revisionId: variantId,
                    baseVariantName: variantName || "",
                    newVariantName: selectedCommitType?.name as string,
                    note,
                    callback: (newVariant, state) => {
                        // For new variant creation, switch to display ONLY the newly created variant
                        // Note: state is a mock object created by the mutation atom, not the full PlaygroundState
                        ;(state as any).selected = [newVariant.id]
                        ;(state as any).variants = [newVariant.id]
                    },
                })

                if (result?.success) {
                    const newVariantId = result.variant?.variantId
                    const newRevisionId = result.variant?.id

                    onSuccess?.({
                        revisionId: newRevisionId,
                        variantId: newVariantId,
                    })

                    await handleDeployAfterCommit(result.variant)

                    // Wait for the state to settle with the new revision (same as version commits)
                    const isAlreadySelected =
                        newRevisionId && selectedRevisionIds?.includes(newRevisionId)
                    const wasSelected = selectedRevisionIds?.includes(variantId)
                    if (newRevisionId && wasSelected && !isAlreadySelected) {
                        startSettleWait(newRevisionId)
                        return // Let selection settle or timeout close
                    }
                }
            }

            // If we get here without setting a wait state, close immediately
            onClose()
        } catch (error) {
            console.error("Failed to commit variant changes:", error)
            message.error("We couldn't save your changes. Please try again.")
            onClose()
        }
    }, [
        selectedCommitType,
        saveVariant,
        createVariant,
        note,
        variantName,
        onSuccess,
        variantId,
        commitType,
        handleDeployAfterCommit,
        onClose,
        selectedRevisionIds,
        startSettleWait,
    ])

    const isOkDisabled =
        !selectedCommitType?.type ||
        (selectedCommitType?.type === "variant" && !selectedCommitType?.name) ||
        (selectedCommitType?.type === "variant" &&
            selectedCommitType?.name &&
            !isVariantNameInputValid(selectedCommitType.name)) ||
        (shouldDeploy && !selectedEnvironment)

    const modalRender = useCallback(
        (modalNode: ReactElement) => (
            <Resizable
                width={modalSize.width}
                height={modalSize.height}
                minConstraints={minConstraints}
                maxConstraints={maxConstraints}
                onResize={(_, data) =>
                    setModalSize({width: data.size.width, height: data.size.height})
                }
                handle={
                    <span
                        className="absolute bottom-2 right-2 h-4 w-4 cursor-se-resize rounded-sm border border-[#CBD5F5] bg-white"
                        onClick={(event) => event.stopPropagation()}
                    />
                }
                resizeHandles={["se"]}
                handleSize={[18, 18]}
                draggableOpts={{enableUserSelectHack: false}}
            >
                <div
                    style={{width: modalSize.width, height: modalSize.height}}
                    className="relative flex min-h-0 flex-col"
                >
                    {modalNode}
                </div>
            </Resizable>
        ),
        [modalSize, minConstraints, maxConstraints],
    )

    const isDeploymentPending = isMutating || (shouldDeploy && isPublishing)

    return (
        <EnhancedModal
            title="Commit changes"
            onCancel={onClose}
            okText="Commit"
            confirmLoading={isDeploymentPending}
            onOk={onSaveVariantChanges}
            okButtonProps={{
                icon: <FloppyDiskBack size={14} />,
                disabled: isOkDisabled,
            }}
            classNames={{footer: "flex items-center justify-end"}}
            width={modalSize.width}
            style={{
                maxWidth: maxConstraints[0],
            }}
            styles={{
                container: {
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    maxHeight: maxConstraints[1],
                },
                body: {
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                },
                footer: {
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    flexShrink: 0,
                    position: "sticky",
                    bottom: 0,
                    background: "#fff",
                },
            }}
            modalRender={modalRender}
            {...modalProps}
        >
            <CommitVariantChangesModalContent
                variantId={variantId}
                note={note}
                setNote={setNote}
                setSelectedCommitType={setSelectedCommitType}
                selectedCommitType={selectedCommitType}
                commitType={commitType}
                shouldDeploy={shouldDeploy}
                onToggleDeploy={setShouldDeploy}
                selectedEnvironment={selectedEnvironment}
                onSelectEnvironment={setSelectedEnvironment}
                isDeploymentPending={isDeploymentPending}
            />
        </EnhancedModal>
    )
}

export default CommitVariantChangesModal
