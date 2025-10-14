import {memo} from "react"

import {Tag} from "antd"
import {useAtomValue} from "jotai"

import {variantUserDisplayNameAtomFamily} from "@/oss/state/variant/selectors/variant"

import Avatar from "../Avatar/Avatar"

interface VariantUserAvatarTagProps {
    variantId: string
    fallback?: string
    nameOverride?: string
}

const VariantUserAvatarTag = memo(
    ({variantId, fallback, nameOverride}: VariantUserAvatarTagProps) => {
        const derivedName = useAtomValue(variantUserDisplayNameAtomFamily(variantId))
        const name =
            nameOverride ||
            (derivedName && derivedName !== "-" ? derivedName : undefined) ||
            fallback ||
            "-"
        return (
            <Tag bordered={false}>
                <Avatar name={name} className="w-4 h-4 text-[9px]" /> {name}
            </Tag>
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
        <Tag bordered={false}>
            <Avatar name={name} className="w-4 h-4 text-[9px]" /> {name}
        </Tag>
    )
})

export default UserAvatarTag
