import type {ReactNode} from "react"

import Link from "next/link"

interface MockupPageShellProps {
    title: string
    blurb: string
    notes?: ReactNode
    children: ReactNode
}

export function MockupPageShell({title, blurb, notes, children}: MockupPageShellProps) {
    return (
        <main style={styles.main}>
            <nav style={styles.nav}>
                <Link href="/" style={styles.backLink}>
                    ← All mockups
                </Link>
            </nav>

            <header style={styles.header}>
                <h1 style={styles.h1}>{title}</h1>
                <p style={styles.blurb}>{blurb}</p>
                {notes ? <div style={styles.notes}>{notes}</div> : null}
            </header>

            <section style={styles.canvas}>{children}</section>
        </main>
    )
}

const styles = {
    main: {
        maxWidth: 1600,
        margin: "0 auto",
        padding: "24px 24px 64px",
        // Defensive — children must not push the page wider than max-width.
        // Side-by-side drawer mockups otherwise overflow into negative-margin
        // territory and clip text.
        minWidth: 0,
    },
    nav: {marginBottom: 16, fontSize: 12},
    backLink: {color: "#1677ff", textDecoration: "none"},
    header: {marginBottom: 24, maxWidth: 960},
    h1: {fontSize: 22, fontWeight: 700, margin: "0 0 8px", color: "#051729"},
    blurb: {
        fontSize: 13,
        color: "rgba(5, 23, 41, 0.65)",
        margin: "4px 0",
        lineHeight: 1.6,
    },
    notes: {
        marginTop: 12,
        padding: "10px 14px",
        background: "#f0f9ff",
        borderLeft: "3px solid #1677ff",
        fontSize: 12,
        lineHeight: 1.6,
        color: "#051729",
        borderRadius: "0 4px 4px 0",
    },
    canvas: {
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        padding: 16,
        minWidth: 0,
    },
}

export default MockupPageShell
