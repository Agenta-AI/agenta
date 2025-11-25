import {PropsWithChildren, ReactNode} from "react"

import {Skeleton, Typography} from "antd"

const {Text} = Typography

export const SectionCard = ({children, className}: PropsWithChildren<{className?: string}>) => (
    <div
        className={`flex flex-col gap-3 rounded-lg border border-[#E4E7EC] bg-white p-4 shadow-[0_6px_18px_rgba(16,24,40,0.06)] ${
            className ?? ""
        }`}
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
