import {PropsWithChildren, ReactNode, type CSSProperties} from "react"

import {Skeleton, Typography} from "antd"
import clsx from "clsx"

const {Text} = Typography

export const SectionCard = ({
    children,
    className,
    style,
}: PropsWithChildren<{className?: string; style?: CSSProperties}>) => (
    <div
        className={`flex flex-col gap-6 border-[0.5px] border-solid border-[var(--ag-c-EAEFF5)] bg-[var(--ag-c-FFFFFF)] p-4 ${className ?? ""}`}
        style={style}
    >
        {children}
    </div>
)

export const SectionHeaderRow = ({
    left,
    right,
    align = "center",
}: {
    left: ReactNode
    right?: ReactNode
    align?: "start" | "center"
}) => (
    <div
        className={`flex justify-between gap-2 ${align === "start" ? "items-start" : "items-center"}`}
    >
        <div className="flex flex-wrap items-center gap-2 min-w-0">{left}</div>
        {right ?? null}
    </div>
)

export const SectionLabel = ({children}: PropsWithChildren) => (
    <Text type="secondary" style={{textTransform: "uppercase", fontWeight: 600, fontSize: 12}}>
        {children}
    </Text>
)

export const ConfigBlock = ({
    title,
    children,
}: PropsWithChildren<{
    title: ReactNode
}>) => (
    <div className="flex flex-col gap-2">
        <SectionLabel>{title}</SectionLabel>
        {children}
    </div>
)

export const SectionSkeleton = ({lines = 4}: {lines?: number}) => (
    <SectionCard>
        <Skeleton active paragraph={{rows: lines}} title={false} />
    </SectionCard>
)

/* ---------- V2 (rail + sections) primitives ---------- */

export const V2Card = ({
    children,
    className,
    style,
    id,
}: PropsWithChildren<{className?: string; style?: CSSProperties; id?: string}>) => (
    <div
        id={id}
        className={clsx(
            "flex flex-col rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer shadow-tremor-input",
            className,
        )}
        style={style}
    >
        {children}
    </div>
)

export const CountBadge = ({children}: PropsWithChildren) => (
    <span className="shrink-0 rounded-[9px] bg-colorFillSecondary px-[7px] py-px font-mono text-[10.5px] leading-4 text-colorTextSecondary">
        {children}
    </span>
)

export const DiffersBadge = () => (
    <span className="shrink-0 rounded-[9px] bg-[#fffbe6] px-[7px] py-px text-[10.5px] font-semibold leading-4 text-[#d48806] dark:bg-[#2b2611]">
        differs
    </span>
)

export const DefList = ({children, className}: PropsWithChildren<{className?: string}>) => (
    <div className={clsx("flex flex-col", className)}>{children}</div>
)

/**
 * Definition-list row: label column (170px wide, 120px below the narrow
 * container breakpoint) + value column, hairline divider between rows.
 */
export const DefRow = ({
    label,
    children,
    differs,
}: PropsWithChildren<{label: ReactNode; differs?: boolean}>) => (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-2 border-0 border-b border-solid border-colorBorderSecondary py-[9px] last:border-b-0 @[860px]:grid-cols-[170px_minmax(0,1fr)]">
        <Text className="pt-0.5 text-[13px] leading-5 text-colorTextTertiary">{label}</Text>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
            {children}
            {differs ? <DiffersBadge /> : null}
        </div>
    </div>
)
