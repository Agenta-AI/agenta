import {memo} from "react"

import {Tag} from "antd"
import {useAtomValue} from "jotai"

import {variantUserDisplayNameAtomFamily} from "@/oss/state/variant/selectors/variant"

import Avatar from "../Avatar/Avatar"

interface UserAvatarTagProps {
    modifiedBy?: string
    variantId?: string
}

const VariantUserAvatarTag = memo(
    ({variantId, fallback}: {variantId: string; fallback?: string}) => {
        const derivedName = useAtomValue(variantUserDisplayNameAtomFamily(variantId))
        const name = derivedName || fallback || "-"
        return (
            <Tag bordered={false}>
                <Avatar name={name} className="w-4 h-4 text-[9px]" /> {name}
            </Tag>
        )
    },
)

const UserAvatarTag = memo(({modifiedBy, variantId}: UserAvatarTagProps) => {
    if (variantId) {
        return <VariantUserAvatarTag variantId={variantId} fallback={modifiedBy} />
    }
    const name = modifiedBy || "-"
    return (
        <Tag bordered={false}>
            <Avatar name={name} className="w-4 h-4 text-[9px]" /> {name}
        </Tag>
    )
})

export default UserAvatarTag
