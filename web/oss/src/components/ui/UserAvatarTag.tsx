import {memo} from "react"

import {Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"
import clsx from "clsx"

import {variantUserDisplayNameAtomFamily} from "@/oss/state/variant/selectors/variant"

import Avatar from "../Avatar/Avatar"

interface VariantUserAvatarTagProps {
    variantId: string
    fallback?: string
    nameOverride?: string
    className?: string
}

const VariantUserAvatarTag = memo(
    ({variantId, fallback, nameOverride, className}: VariantUserAvatarTagProps) => {
        const derivedName = useAtomValue(variantUserDisplayNameAtomFamily(variantId))
        const name =
            nameOverride ||
            (derivedName && derivedName !== "-" ? derivedName : undefined) ||
            fallback ||
            "-"
        return (
            <Tag
                bordered={false}
                className={clsx(
                    "inline-flex max-w-[126px] items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-[1px] text-[11px] font-medium text-neutral-700",
                    className,
                )}
            >
                <Avatar name={name} className="h-[18px] w-[18px] text-[9px]" />
                <Tooltip title={name} placement="top">
                    <span className="max-w-[86px] truncate">{name}</span>
                </Tooltip>
            </Tag>
        )
    },
)

interface UserAvatarTagProps {
    modifiedBy?: string
    variantId?: string
    nameOverride?: string
    isCurrentUser?: boolean
    className?: string
}

const UserAvatarTag = memo(
    ({
        modifiedBy,
        variantId,
        nameOverride,
        isCurrentUser = false,
        className,
    }: UserAvatarTagProps) => {
        if (variantId) {
            return (
                <VariantUserAvatarTag
                    variantId={variantId}
                    fallback={modifiedBy}
                    nameOverride={nameOverride}
                    className={className}
                />
            )
        }
        const name = nameOverride || modifiedBy || "-"
        const label = isCurrentUser ? `${name} (you)` : name
        return (
            <Tag
                bordered={false}
                className={clsx(
                    "inline-flex max-w-[126px] items-center gap-1 rounded-full px-1.5 py-[1px] text-[11px] font-medium",
                    isCurrentUser
                        ? "bg-primary-50 text-primary-700"
                        : "bg-neutral-100 text-neutral-700",
                    className,
                )}
            >
                <Avatar name={name} className="h-[18px] w-[18px] text-[9px]" />
                <Tooltip title={label} placement="top">
                    <span className="max-w-[86px] truncate">{label}</span>
                </Tooltip>
            </Tag>
        )
    },
)

export default UserAvatarTag
