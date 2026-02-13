import {type ReactElement, useCallback, useEffect, useMemo, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {FloppyDiskBack} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {Resizable} from "react-resizable"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {saveVariantMutationAtom} from "@/oss/components/Playground/state/atoms"
import {isVariantNameInputValid} from "@/oss/lib/helpers/utils"
import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"
import {moleculeBackedVariantAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

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
    // Get variant metadata using molecule-backed atom (works for both server revisions and local drafts)
    const variant = useAtomValue(moleculeBackedVariantAtomFamily(variantId || ""))

    // Extract values from variant
    const variantName = variant?.variantName

    // Get mutation functions
    const saveVariant = useSetAtom(saveVariantMutationAtom)
    const createVariant = useSetAtom(createVariantMutationAtom)
    const {mutateAsync: publish} = useAtomValue(publishMutationAtom)

    // Track loading state for mutations
    const [isMutating, setIsMutating] = useState(false)

    const [selectedCommitType, setSelectedCommitType] = useState<SelectedCommitType>({
        type: "version",
    })
    const [note, setNote] = useState("")
    const [shouldDeploy, setShouldDeploy] = useState(false)
    const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(null)
    const [modalSize, setModalSize] = useState({width: 960, height: 640})
    const [viewport, setViewport] = useState({width: 0, height: 0})

    const onClose = useCallback(() => {
        onCancel?.({} as any)
        setIsMutating(false)
        setSelectedCommitType({
            type: "version",
        })
        setNote("")
        setShouldDeploy(false)
        setSelectedEnvironment(null)
    }, [onCancel])

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

    const fireDeployAfterCommit = useCallback(
        (resultVariant: any, environment: string, commitNote: string) => {
            const variantIdForDeployment =
                resultVariant?.variant_id || resultVariant?.variantId || variant?.variantId

            const revisionIdForDeployment =
                resultVariant?.id || resultVariant?.revision_id || variantId

            const revisionLabel = resultVariant?.revision
                ? `v${resultVariant.revision}`
                : "new version"

            if (!variantIdForDeployment) {
                message.error("Unable to deploy because the variant identifier is missing.")
                return
            }

            const deployMessageKey = `deploy-${variantIdForDeployment}-${Date.now()}`

            message.loading({
                content: `Deploying ${revisionLabel} to ${environment}`,
                key: deployMessageKey,
                duration: 0,
            })

            publish({
                type: "variant",
                variant_id: variantIdForDeployment,
                revision_id: revisionIdForDeployment ?? undefined,
                environment_name: environment,
                note: commitNote,
            })
                .then(() => {
                    message.success({
                        content: `${revisionLabel} has been successfully deployed to ${environment}`,
                        key: deployMessageKey,
                    })
                })
                .catch((error) => {
                    console.error("Failed to deploy after commit", error)
                    message.error({
                        content: `Failed to deploy ${revisionLabel} to ${environment}`,
                        key: deployMessageKey,
                    })
                })
        },
        [publish, variant, variantId],
    )

    const onSaveVariantChanges = useCallback(async () => {
        // Capture deploy settings before mutation (modal will close after commit)
        const deployEnabled = shouldDeploy
        const deployEnvironment = selectedEnvironment
        const commitNote = note

        try {
            setIsMutating(true)

            if (selectedCommitType?.type === "version") {
                const result = await saveVariant?.({
                    variantId,
                    note: commitNote,
                    commitType,
                })

                if (result?.success) {
                    onSuccess?.({
                        revisionId: result.variant?.id,
                        variantId: result.variant?.variantId,
                    })

                    // Fire deploy in background (don't await) and close modal immediately
                    if (deployEnabled && deployEnvironment) {
                        fireDeployAfterCommit(result.variant, deployEnvironment, commitNote)
                    }

                    setIsMutating(false)
                    onClose()
                    return
                }
            } else if (selectedCommitType?.type === "variant" && selectedCommitType?.name) {
                const result = await createVariant?.({
                    revisionId: variantId,
                    baseVariantName: variantName || "",
                    newVariantName: selectedCommitType?.name as string,
                    note: commitNote,
                    callback: (newVariant, state) => {
                        // Replace the local draft with the new variant, preserving other variants in selection
                        // Note: state is a mock object created by the mutation atom, not the full PlaygroundState
                        const currentSelected = (state as any).selected as string[]
                        ;(state as any).selected = currentSelected.map((id: string) =>
                            id === variantId ? newVariant.id : id,
                        )
                        ;(state as any).variants = (state as any).selected
                    },
                })

                if (result?.success) {
                    const newVariantId = result.variant?.variantId
                    const newRevisionId = result.variant?.id

                    onSuccess?.({
                        revisionId: newRevisionId,
                        variantId: newVariantId,
                    })

                    // Fire deploy in background (don't await) and close modal immediately
                    if (deployEnabled && deployEnvironment) {
                        fireDeployAfterCommit(result.variant, deployEnvironment, commitNote)
                    }

                    setIsMutating(false)
                    onClose()
                    return
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
        shouldDeploy,
        selectedEnvironment,
        fireDeployAfterCommit,
        onClose,
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

    const isDeploymentPending = isMutating

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
