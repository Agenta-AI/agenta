/**
 * DrawerSurface — fills its container with the production testcase-drawer
 * chrome (header bar + body) so the drill-in renders in production-shaped
 * context. Must fit cleanly inside narrow columns (e.g. SideBySide on a
 * 1200px page → ~570px per column), so no fixed-width / absolute positioning
 * here. The "table dimmed behind" backdrop pattern only made sense as a
 * single-page hero; it's removed.
 */

import type {ReactNode} from "react"

import {Button} from "antd"

interface DrawerSurfaceProps {
    title: string
    rightToolbar?: ReactNode
    children: ReactNode
    /** When true, sizes to 720px tall; otherwise grows with content */
    fixedHeight?: boolean
}

export function DrawerSurface({
    title,
    rightToolbar,
    children,
    fixedHeight = false,
}: DrawerSurfaceProps) {
    return (
        <div
            style={{
                ...styles.frame,
                ...(fixedHeight ? styles.fixedHeight : null),
            }}
        >
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    <span style={styles.navArrows}>« ⌃ ⌄</span>
                    <span style={styles.title}>{title}</span>
                </div>
                <div style={styles.headerRight}>
                    {rightToolbar ?? null}
                    <Button size="small">+ Add to queue</Button>
                </div>
            </header>
            <div style={styles.body}>{children}</div>
        </div>
    )
}

const styles = {
    frame: {
        width: "100%",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column" as const,
        boxShadow: "0 4px 16px rgba(5, 23, 41, 0.04)",
    },
    fixedHeight: {
        height: 720,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
        background: "white",
        flexShrink: 0,
        flexWrap: "wrap" as const,
    },
    headerLeft: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
        flex: 1,
    },
    navArrows: {
        fontSize: 12,
        color: "rgba(5, 23, 41, 0.55)",
        letterSpacing: "0.2em",
        flexShrink: 0,
    },
    title: {
        fontSize: 13,
        fontWeight: 600,
        color: "#051729",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        minWidth: 0,
    },
    headerRight: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
    },
    body: {
        flex: 1,
        overflowY: "auto" as const,
        overflowX: "auto" as const,
        padding: 14,
        background: "white",
        minWidth: 0,
    },
}

export default DrawerSurface
