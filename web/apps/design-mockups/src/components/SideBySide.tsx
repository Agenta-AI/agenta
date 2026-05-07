/**
 * SideBySide — two- or three-column comparison layout. Each column has a small
 * header (label + sub-label) and a body region. The third column is optional
 * and is intended for a "Proposed v2" / iteration panel mounted next to the
 * existing Today vs Proposed comparison.
 */

import type {ReactNode} from "react"

interface SideBySideProps {
    todayLabel?: string
    todaySub?: string
    today: ReactNode
    proposedLabel?: string
    proposedSub?: string
    proposed: ReactNode
    /** Optional third column. When provided, renders a 3-column grid. */
    thirdLabel?: string
    thirdSub?: string
    third?: ReactNode
}

export function SideBySide({
    todayLabel = "Today",
    todaySub,
    today,
    proposedLabel = "Proposed",
    proposedSub,
    proposed,
    thirdLabel = "Proposed v2",
    thirdSub,
    third,
}: SideBySideProps) {
    const hasThird = third !== undefined
    return (
        <div style={hasThird ? styles.gridThree : styles.grid}>
            <section style={styles.column}>
                <header style={styles.colHeader}>
                    <span style={{...styles.tag, ...styles.tagToday}}>{todayLabel}</span>
                    {todaySub ? <span style={styles.colSub}>{todaySub}</span> : null}
                </header>
                <div style={styles.body}>{today}</div>
            </section>
            <section style={styles.column}>
                <header style={styles.colHeader}>
                    <span style={{...styles.tag, ...styles.tagProposed}}>{proposedLabel}</span>
                    {proposedSub ? <span style={styles.colSub}>{proposedSub}</span> : null}
                </header>
                <div style={styles.body}>{proposed}</div>
            </section>
            {hasThird ? (
                <section style={styles.column}>
                    <header style={styles.colHeader}>
                        <span style={{...styles.tag, ...styles.tagThird}}>{thirdLabel}</span>
                        {thirdSub ? <span style={styles.colSub}>{thirdSub}</span> : null}
                    </header>
                    <div style={styles.body}>{third}</div>
                </section>
            ) : null}
        </div>
    )
}

const styles = {
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 16,
    },
    gridThree: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 16,
    },
    column: {
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column" as const,
        // Required so children with `min-width: auto` (drawers, code blocks)
        // can shrink inside the grid track. Without this they push the
        // column wider than `1fr` and clip the parent.
        minWidth: 0,
    },
    colHeader: {
        padding: "10px 14px",
        background: "white",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    tag: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    tagToday: {
        background: "rgba(5, 23, 41, 0.06)",
        color: "rgba(5, 23, 41, 0.65)",
    },
    tagProposed: {
        background: "#f0f9ff",
        color: "#1677ff",
    },
    tagThird: {
        background: "#f6ffed",
        color: "#389e0d",
    },
    colSub: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
    },
    body: {
        padding: 0,
        flex: 1,
        minHeight: 0,
    },
}

export default SideBySide
