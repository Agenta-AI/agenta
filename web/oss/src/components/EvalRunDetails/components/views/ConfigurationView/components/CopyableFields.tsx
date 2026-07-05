import {PropsWithChildren} from "react"

import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"
import clsx from "clsx"

import ReadOnlyBox from "@/oss/components/pages/evaluations/onlineEvaluation/components/ReadOnlyBox"

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
        return <span className="text-muted-foreground">{placeholder}</span>
    }

    const toneClass = {
        default: "text-[var(--ag-c-1D2939)]",
        secondary: "text-[var(--ag-c-667085)]",
        muted: "text-[var(--ag-c-98A2B3)]",
    }[tone]

    return (
        <TooltipWithCopyAction title="Copy value" copyText={copyValue ?? value}>
            <span
                className={clsx(
                    "inline-flex w-full max-w-full cursor-copy items-center",
                    strong && "font-semibold",
                    toneClass,
                    className,
                )}
            >
                <span className="block w-full max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                    {value}
                </span>
            </span>
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
            {tertiary ? <span className="text-muted-foreground">{tertiary}</span> : null}
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
        <Skeleton className="h-5 w-full" />
    </ReadOnlyBox>
)

export const CopyableBadge = ({label, copyValue}: {label: string; copyValue?: string}) => (
    <TooltipWithCopyAction title="Copy value" copyText={copyValue ?? label}>
        <span
            className="inline-flex cursor-copy items-center rounded border border-[var(--ag-c-D0D5DD)] bg-[var(--ag-c-F9FAFB)] px-2 py-[2px] text-[var(--ag-c-475467)]"
            style={{fontSize: 12, lineHeight: "18px"}}
        >
            {label}
        </span>
    </TooltipWithCopyAction>
)

export const ReadOnlyContainer = ({children}: PropsWithChildren<{}>) => (
    <ReadOnlyBox>{children}</ReadOnlyBox>
)
