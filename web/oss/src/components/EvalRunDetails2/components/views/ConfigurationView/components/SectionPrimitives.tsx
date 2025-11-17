import {PropsWithChildren, ReactNode} from "react"

import {Typography} from "antd"

const {Text} = Typography

export const SectionCard = ({children}: PropsWithChildren) => (
    <div className="flex flex-col gap-3 rounded-lg border border-transparent bg-white p-2 shadow-sm hover:border-neutral-200">
        {children}
    </div>
)

export const SectionHeaderRow = ({left, right}: {left: ReactNode; right?: ReactNode}) => (
    <div className="flex items-center justify-between gap-2">
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
