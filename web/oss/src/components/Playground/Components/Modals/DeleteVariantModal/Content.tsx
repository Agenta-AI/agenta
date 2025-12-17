import {useCallback, useEffect, useMemo, useState} from "react"

import {Trash} from "@phosphor-icons/react"
import {Button, Spin, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    deleteVariantMutationAtom,
    variantByRevisionIdAtomFamily,
} from "@/oss/components/Playground/state/atoms"
import VariantNameCell from "@/oss/components/VariantNameCell"
import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"
import {parentVariantDisplayNameAtomFamily} from "@/oss/state/variant/selectors/variant"

const {Text} = Typography

interface Props {
    variantId: string
    onClose: () => void
}

const DeleteVariantContent = ({variantId, onClose}: Props) => {
    // Focused atom family to avoid subscribing to a large list
    const variant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any
    const deleteVariant = useSetAtom(deleteVariantMutationAtom)

    const [checking, setChecking] = useState(true)
    const [canDelete, setCanDelete] = useState<boolean | null>(null)

    // Derive parent variant id from revision to resolve display name
    const parentVariantId = (variant?._parentVariant ?? variant?.variantId) as string | undefined
    const parentDisplayName = useAtomValue(
        parentVariantDisplayNameAtomFamily(parentVariantId || ""),
    )

    const {_variantName, isMutating} = useMemo(() => {
        return {
            _variantName: (parentDisplayName as string) || "-",
            isMutating: (variant as any)?.__isMutating || false,
        }
    }, [parentDisplayName, variant])

    // On mount, verify if resource is eligible for deletion
    useEffect(() => {
        let mounted = true
        ;(async () => {
            try {
                const ok = await checkIfResourceValidForDeletion({
                    resourceType: "variant",
                    resourceIds: [variantId],
                })
                if (mounted) setCanDelete(ok)
            } catch (e) {
                if (mounted) setCanDelete(false)
            } finally {
                if (mounted) setChecking(false)
            }
        })()
        return () => {
            mounted = false
        }
    }, [variantId])

    const onDeleteVariant = useCallback(async () => {
        try {
            const res = (await deleteVariant({variantId})) as any
            if (res?.success) {
                onClose()
            } else {
                console.error("Failed to delete variant:", res?.error || "unknown error")
            }
        } catch (error) {
            console.error("Failed to delete variant:", error)
        }
    }, [deleteVariant, variantId, onClose])

    // Loading state during pre-check
    if (checking) {
        return (
            <div className="flex items-center gap-3 py-6">
                <Spin />
                <Text>Checking if this variant can be deleted…</Text>
            </div>
        )
    }

    // Blocked state if not deletable
    if (canDelete === false) {
        return (
            <section className="flex flex-col gap-4">
                <Text>This variant cannot be deleted because it is currently in use.</Text>
                <div className="flex items-center justify-end">
                    <Button type="primary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </section>
        )
    }

    // Ready state
    return (
        <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <Text>You are about to delete:</Text>
                    <VariantNameCell revisionId={variantId} showBadges />
                </div>
                <Text>This action is not reversible. Deleting the revision will also</Text>
            </div>

            <div className="flex items-center justify-end gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    type="primary"
                    danger
                    loading={isMutating}
                    icon={<Trash size={14} />}
                    onClick={onDeleteVariant}
                >
                    Delete
                </Button>
            </div>
        </section>
    )
}

export default DeleteVariantContent
