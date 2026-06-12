import {useState, type PropsWithChildren, type ReactNode} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Typography} from "antd"
import clsx from "clsx"

import {CountBadge, DiffersBadge, V2Card} from "./SectionPrimitives"

const {Text} = Typography

/**
 * Collapsible V2 section card. Header: title + mono count badge + one-line
 * summary (so collapsed sections still inform) + optional differs badge,
 * header-right slot, and a caret.
 */
const V2SectionShell = ({
    id,
    title,
    count,
    summary,
    differs,
    headerRight,
    defaultCollapsed = false,
    flush = false,
    children,
}: PropsWithChildren<{
    id?: string
    title: string
    count?: number | null
    summary?: string | null
    differs?: boolean
    headerRight?: ReactNode
    defaultCollapsed?: boolean
    /** Render children edge-to-edge (e.g. evaluator rows) instead of padded. */
    flush?: boolean
}>) => {
    const [collapsed, setCollapsed] = useState(defaultCollapsed)

    return (
        <V2Card id={id} className="scroll-mt-4">
            {/* Mouse-only click target; the caret Button below is the single
                keyboard-accessible toggle (avoids nested interactive controls). */}
            <div
                className={clsx(
                    "flex h-10 cursor-pointer select-none items-center gap-2 border-0 border-solid border-colorBorderSecondary px-4",
                    !collapsed && "border-b",
                )}
                onClick={() => setCollapsed((value) => !value)}
            >
                <Text className="shrink-0 text-[13px] font-semibold">{title}</Text>
                {count != null ? <CountBadge>{count}</CountBadge> : null}
                {summary ? (
                    <Text className="min-w-0 flex-1 truncate text-xs text-colorTextTertiary">
                        {summary}
                    </Text>
                ) : (
                    <span className="flex-1" />
                )}
                {differs ? <DiffersBadge /> : null}
                {headerRight ? (
                    <span
                        className="flex shrink-0 items-center gap-2"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {headerRight}
                    </span>
                ) : null}
                <Button
                    type="text"
                    size="small"
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${title} section`}
                    icon={<DownOutlined rotate={collapsed ? -90 : 0} style={{fontSize: 12}} />}
                    onClick={(event) => {
                        event.stopPropagation()
                        setCollapsed((value) => !value)
                    }}
                />
            </div>
            {!collapsed ? <div className={flush ? "" : "p-4"}>{children}</div> : null}
        </V2Card>
    )
}

export default V2SectionShell
