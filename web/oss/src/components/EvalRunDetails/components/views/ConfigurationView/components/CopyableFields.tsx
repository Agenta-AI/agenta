import {PropsWithChildren} from "react"

import {Skeleton, Typography} from "antd"
import clsx from "clsx"

import ReadOnlyBox from "@/oss/components/pages/evaluations/onlineEvaluation/components/ReadOnlyBox"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"

const {Text} = Typography

interface CopyableTextProps {
    value?: string | null
    copyValue?: string
    className?: string
    placeholder?: string
    tone?: "default" | "secondary" | "muted"
    strong?: boolean
}

export const CopyableText = ({
    value,
    copyValue,
    className,
    placeholder = "—",
    tone = "default",
    strong = false,
}: CopyableTextProps) => {
    if (!value || value.trim() === "") {
        return <Text type="secondary">{placeholder}</Text>
    }

    const toneClass = {
        default: "text-[#1D2939]",
        secondary: "text-[#667085]",
        muted: "text-[#98A2B3]",
    }[tone]

    return (
        <TooltipWithCopyAction title="Copy value" copyText={copyValue ?? value}>
            <Text
                className={clsx(
                    "inline-flex w-full max-w-full cursor-copy items-center",
                    toneClass,
                    className,
                )}
                strong={strong}
            >
                <span className="block w-full max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                    {value}
                </span>
            </Text>
        </TooltipWithCopyAction>
    )
}

export const ReferenceSummary = ({
    primary,
    secondary,
    tertiary,
    copyPrimary,
    copySecondary,
}: {
    primary?: string | null
    secondary?: string
    tertiary?: string
    copyPrimary?: string
    copySecondary?: string
}) => (
    <ReadOnlyBox>
        <div className="flex flex-col gap-1">
            <CopyableText
                value={primary}
                copyValue={copyPrimary ?? copySecondary ?? primary ?? undefined}
                strong
            />
            {secondary ? (
                <CopyableText
                    value={secondary}
                    copyValue={copySecondary ?? secondary}
                    tone="secondary"
                />
            ) : null}
            {tertiary ? <Text type="secondary">{tertiary}</Text> : null}
        </div>
    </ReadOnlyBox>
)

export const ReadOnlyCopy = ({value}: {value: string | null | undefined}) => (
    <ReadOnlyBox>
        <CopyableText value={value} copyValue={value ?? undefined} />
    </ReadOnlyBox>
)

export const ReadOnlySkeleton = () => (
    <ReadOnlyBox>
        <Skeleton.Input active size="small" style={{width: "100%"}} />
    </ReadOnlyBox>
)

export const CopyableBadge = ({label, copyValue}: {label: string; copyValue?: string}) => (
    <TooltipWithCopyAction title="Copy value" copyText={copyValue ?? label}>
        <span
            className="inline-flex cursor-copy items-center rounded border border-[#D0D5DD] bg-[#F9FAFB] px-2 py-[2px] text-[#475467]"
            style={{fontSize: 12, lineHeight: "18px"}}
        >
            {label}
        </span>
    </TooltipWithCopyAction>
)

export const ReadOnlyContainer = ({children}: PropsWithChildren<{}>) => (
    <ReadOnlyBox>{children}</ReadOnlyBox>
)
