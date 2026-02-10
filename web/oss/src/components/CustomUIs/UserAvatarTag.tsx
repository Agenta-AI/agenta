import {memo} from "react"

import {useAtomValue} from "jotai"

import {moleculeBackedVariantAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

import Avatar from "../Avatar/Avatar"

interface VariantUserAvatarTagProps {
    variantId: string
    fallback?: string
    nameOverride?: string
}

const VariantUserAvatarTag = memo(
    ({variantId, fallback, nameOverride}: VariantUserAvatarTagProps) => {
        const revisionData = useAtomValue(moleculeBackedVariantAtomFamily(variantId)) as any
        const derivedName: string | null =
            revisionData?.modifiedByDisplayName ??
            revisionData?.modifiedBy ??
            revisionData?.modified_by ??
            null
        const name =
            nameOverride ||
            (derivedName && derivedName !== "-" ? derivedName : undefined) ||
            fallback ||
            "-"
        return (
            <span className="text-ellipsis overflow-hidden">
                <Avatar name={name} className="w-4 h-4 text-[9px]" /> {name}
            </span>
        )
    },
)

interface UserAvatarTagProps {
    modifiedBy?: string
    variantId?: string
    nameOverride?: string
}

const UserAvatarTag = memo(({modifiedBy, variantId, nameOverride}: UserAvatarTagProps) => {
    if (variantId) {
        return (
            <VariantUserAvatarTag
                variantId={variantId}
                fallback={modifiedBy}
                nameOverride={nameOverride}
            />
        )
    }
    const name = nameOverride || modifiedBy || "-"
    return (
        <span className="text-ellipsis overflow-hidden">
            <Avatar name={name} className="w-4 h-4 text-[9px]" /> {name}
        </span>
    )
})

export default UserAvatarTag
