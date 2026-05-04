/**
 * Alt — Two-pane tree+detail drill-in.
 *
 * Paradigmatically different alternative to the card-stack ProposedDrillIn
 * (gap-03 baseline). Surfaced 2026-05-04 by alternative-design exploration.
 * Side-by-side comparison on `06 Deeply Nested` (Tuvalu) — the fixture where
 * card-stack fatigue is the worst.
 */

import {useState} from "react"

import Head from "next/head"

import {Segmented} from "antd"

import {DrawerSurface} from "@/mockups/components/DrawerSurface"
import {MockupPageShell} from "@/mockups/components/MockupPageShell"
import {SideBySide} from "@/mockups/components/SideBySide"
import {ProposedDrillIn} from "@/mockups/components/proposed/ProposedDrillIn"
import {TreeDrillIn} from "@/mockups/components/proposed/TreeDrillIn"
import {
    fixture02_capitals_with_geo,
    fixture06_deeply_nested,
    fixture07_messages_and_tools,
    fixture08_dot_key_collision,
    fixture_chip_showcase,
} from "@/mockups/data/stubTestcases"

const FIXTURES = [
    {
        id: "06-deep",
        label: "06 deeply nested",
        testcase: fixture06_deeply_nested.find((tc) => tc.id === "tc-06-tuvalu")!,
        autoExpand: true,
        detectDotKeyCollisions: false,
        note: "Depth-5 nested structure. The strongest case for two-pane — card-stack scrolls, tree gives a one-glance overview.",
    },
    {
        id: "07-messages",
        label: "07 messages + tools",
        testcase: fixture07_messages_and_tools.find((tc) => tc.id === "tc-07-kiribati-tool")!,
        autoExpand: true,
        detectDotKeyCollisions: false,
        note: "Each message is a tree node — pick one to focus the chat card on the right. Tool calls stay inline inside the assistant message.",
    },
    {
        id: "08-collision",
        label: "08 dot-key collision",
        testcase: fixture08_dot_key_collision.find((tc) => tc.id === "tc-08-vanuatu")!,
        autoExpand: true,
        detectDotKeyCollisions: true,
        note: "Literal `\"geo.region\"` and nested `geo` sit two rows apart in the tree, both with chips. Spatial separation reads as cleanly as side-by-side cards.",
    },
    {
        id: "02-nested",
        label: "02 nested native",
        testcase: fixture02_capitals_with_geo.find((tc) => tc.id === "tc-02-tuvalu")!,
        autoExpand: true,
        detectDotKeyCollisions: false,
        note: "Moderate nesting. Tree shape readable in one glance vs scrolling between cards.",
    },
    {
        id: "01-flat",
        label: "01 chip showcase (canary)",
        testcase: fixture_chip_showcase[0],
        autoExpand: false,
        detectDotKeyCollisions: false,
        note: "The fixture where two-pane LOSES — short flat keys against a tree column is overkill. Included to demonstrate the threshold case.",
    },
] as const

export default function AltTreePane() {
    const [fixtureId, setFixtureId] =
        useState<(typeof FIXTURES)[number]["id"]>("06-deep")
    const [editMode, setEditMode] = useState<"editable" | "read-only">("editable")
    const editable = editMode === "editable"

    const active = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0]
    const tc = active.testcase

    return (
        <>
            <Head>
                <title>Alt — Two-pane tree+detail · Design mockups</title>
            </Head>
            <MockupPageShell
                title="Alt — Two-pane tree + detail (alternative paradigm)"
                blurb={
                    "Side-by-side: card-stack (Today, left, ProposedDrillIn) vs two-pane tree+detail (Right, TreeDrillIn). Pick a fixture below to see how each paradigm handles different testcase shapes. The argument isn't that two-pane wins everywhere — it's that the card-stack paradigm has a specific failure mode (06 deeply nested, 07 messages-and-tools) that two-pane resolves cleanly."
                }
                notes={
                    <>
                        <strong>Why this exists:</strong> the card-stack we proposed in
                        gap-03 still scrolls badly at depth ≥ 4. Three alternative
                        paradigms were sketched (outliner, two-pane, tabbed) — two-pane
                        had the strongest cross-fixture story so it was built. See
                        agent-comparison notes in <code>00-overview.md</code>.
                        <br />
                        <br />
                        <strong>Threshold-fallback hybrid is the real shipping shape.</strong>{" "}
                        Below ~6 leaves OR depth &lt; 2 OR no messages array, the
                        production card-stack is still the better default. Two-pane
                        kicks in above that threshold. The 01-flat fixture is here to
                        demonstrate where two-pane stops being useful.
                        <br />
                        <br />
                        <strong>Keyboard:</strong> click into the tree, then ↑/↓ to
                        move, →/← to expand/collapse.
                    </>
                }
                competitiveNotes={
                    <>
                        Closest to Braintrust's right-rail pattern (see{" "}
                        <a
                            href="../../../docs/designs/json-string-ux/competitive-analysis.md"
                            style={{color: "#1677ff"}}
                        >
                            competitive-analysis.md
                        </a>{" "}
                        §3) but flips it — Braintrust uses the right rail for the form;
                        here the left side is a navigator and the right side is the
                        editor. Combined with gap-07's schema-aware form, the two
                        compose into "this is what schema-aware editing looks like with
                        navigation". Outliner and tabbed alternatives were considered;
                        notes-only entries kept in the design exploration.
                    </>
                }
            >
                <div style={styles.toolbar}>
                    <span style={styles.label}>Fixture:</span>
                    <Segmented
                        size="small"
                        value={fixtureId}
                        options={FIXTURES.map((f) => ({label: f.label, value: f.id}))}
                        onChange={(v) =>
                            setFixtureId(v as (typeof FIXTURES)[number]["id"])
                        }
                    />
                    <span style={styles.spacer} />
                    <span style={styles.label}>Mode:</span>
                    <Segmented
                        size="small"
                        value={editMode}
                        options={[
                            {label: "Editable", value: "editable"},
                            {label: "Read only", value: "read-only"},
                        ]}
                        onChange={(v) => setEditMode(v as "editable" | "read-only")}
                    />
                </div>
                <div style={styles.fixtureNote}>{active.note}</div>
                <SideBySide
                    todaySub="ProposedDrillIn — card-stack baseline"
                    today={
                        <DrawerSurface title={`Testcase · ${tc.label}`}>
                            <ProposedDrillIn
                                key={`${active.id}-card`}
                                data={tc.data}
                                rootTitle={tc.label}
                                autoExpand={active.autoExpand}
                                detectDotKeyCollisions={active.detectDotKeyCollisions}
                                editable={editable}
                            />
                        </DrawerSurface>
                    }
                    proposedSub="TreeDrillIn — two-pane tree + detail (alternative)"
                    proposed={
                        <DrawerSurface title={`Testcase · ${tc.label}`} fixedHeight>
                            <TreeDrillIn
                                key={`${active.id}-tree`}
                                data={tc.data}
                                rootTitle={tc.label}
                                autoExpand={active.autoExpand}
                                detectDotKeyCollisions={active.detectDotKeyCollisions}
                                editable={editable}
                            />
                        </DrawerSurface>
                    }
                />
            </MockupPageShell>
        </>
    )
}

const styles = {
    toolbar: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap" as const,
        gap: 12,
        padding: "10px 14px",
        marginBottom: 12,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
    },
    label: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
    },
    spacer: {
        flex: 1,
    },
    fixtureNote: {
        marginBottom: 12,
        padding: "10px 14px",
        background: "#fffbe6",
        borderLeft: "3px solid #faad14",
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.6,
        borderRadius: "0 4px 4px 0",
    },
}
