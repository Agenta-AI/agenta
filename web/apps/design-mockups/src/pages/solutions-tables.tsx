/**
 * Solutions · Tables — unified demo combining every table-related proposal.
 *
 * Production TestcaseCellContent (Today, left) vs ProposedTableCell (Proposed,
 * right) on a fixture grid that exercises:
 *   - gap-01: type chips on every cell
 *   - gap-02: cell rendering for objects/arrays/messages with chip + count
 *   - gap-04: union-projected key marker (em-dash for missing)
 *   - gap-05: dotted-key + collision chips on column headers
 *   - gap-06: messages-shaped array preview
 *
 * The chip-mode toggle drives the proposed side. The same toggle exists on
 * the drill-in and playground solution pages — chip vocabulary decision
 * propagates across surfaces.
 */

import {useMemo, useState} from "react"

import Head from "next/head"
import Link from "next/link"

import {Segmented} from "antd"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"
import {ProposedTableCell} from "@/mockups/components/proposed/ProposedTableCell"
import {type ChipRenderMode} from "@/mockups/components/proposed/ProposedDrillIn"
import TestcaseCellContent from "@/oss/components/TestcasesTableNew/components/TestcaseCellContent"

interface CellFixture {
    label: string
    note?: string
    gap?: string
    value: unknown
    flags?: {
        mixed?: boolean
        dottedKey?: boolean
        collision?: boolean
        missing?: boolean
    }
}

const cellFixtures: CellFixture[] = [
    // gap-01 — primitive chip variants
    {
        label: "string (short)",
        gap: "gap-01",
        value: "Tuvalu",
    },
    {
        label: "string (long, truncated)",
        gap: "gap-02",
        value:
            "The capital of Kiribati is South Tarawa, a small atoll located in the central Pacific Ocean approximately 4,000 km southwest of Hawaii.",
    },
    {
        label: "number",
        gap: "gap-01",
        value: 11,
    },
    {
        label: "boolean",
        gap: "gap-01",
        value: true,
    },
    // gap-02 — structured cells
    {
        label: "object (small)",
        gap: "gap-02",
        value: {countryName: "Kiribati", capital: "South Tarawa"},
    },
    {
        label: "object (deep)",
        gap: "gap-02",
        value: {
            countryName: "Tuvalu",
            geo: {region: "Polynesia", coordinates: {lat: -8.52, lng: 179.2}},
            verified: null,
        },
    },
    {
        label: "array of records",
        note: "fixture 03 — neighbors",
        gap: "gap-02",
        value: [
            {name: "Marshall Islands", relation: "neighbor"},
            {name: "Tuvalu", relation: "neighbor"},
            {name: "Nauru", relation: "neighbor"},
        ],
    },
    {
        label: "array of strings",
        note: "fixture 03 — languages",
        gap: "gap-02",
        value: ["en", "tvl"],
    },
    // gap-06 — messages
    {
        label: "messages array",
        note: "fixture 07 — chat",
        gap: "gap-06",
        value: [
            {role: "system", content: "You are a geography assistant."},
            {role: "user", content: "What is the capital of Kiribati?"},
            {role: "assistant", content: "South Tarawa."},
        ],
    },
    // gap-01 / gap-02 — null + missing
    {
        label: "null",
        gap: "gap-01",
        value: null,
    },
    {
        label: "missing key",
        note: "column exists in other rows",
        gap: "gap-04",
        value: undefined,
        flags: {missing: true},
    },
    // gap-02/04 — stringified-JSON
    {
        label: "stringified-JSON-as-string",
        note: "fixture 04 — looks like obj, stored as string",
        gap: "gap-02 + gap-04",
        value: '{"countryName":"Kiribati","capital":"South Tarawa","metadata":{"source":"trace"}}',
    },
    // gap-05 — dot-key + collision
    {
        label: "literal dotted key",
        note: "fixture 08 column header",
        gap: "gap-05",
        value: "Polynesia",
        flags: {dottedKey: true},
    },
    {
        label: "collision row",
        note: "Vanuatu — both literal + nested exist",
        gap: "gap-05",
        value: "LITERAL_DOT_VALUE",
        flags: {collision: true, dottedKey: true},
    },
    // mixed column
    {
        label: "mixed column",
        note: "different rows have different types in this column",
        gap: "gap-02",
        value: 42,
        flags: {mixed: true},
    },
]

export default function SolutionsTables() {
    const grid = useMemo(() => cellFixtures, [])
    const [chipMode, setChipMode] = useState<ChipRenderMode>("all")

    return (
        <>
            <Head>
                <title>Solutions · Tables — unified testset cell demo</title>
            </Head>
            <MockupPageShell
                title="Solutions · Tables (testset cells)"
                blurb={
                    "Production TestcaseCellContent (Today, left) — already has CellContentPopover, syntax-highlighted JsonCellContent, ChatMessagesCellContent, em-dash for empty values — next to ProposedTableCell (Proposed, right) which adds the chip vocabulary + denser preview format. Same fixture across both. Chip-mode toggle drives the proposed side."
                }
                notes={
                    <>
                        <strong>What production already does (Today column):</strong>{" "}
                        <code>TestcaseCellContent</code> delegates to{" "}
                        <code>@agenta/ui/cell-renderers</code> — type detection
                        via <code>tryParseJson</code> +{" "}
                        <code>extractChatMessages</code>, type-based renderers
                        (<code>JsonCellContent</code> /{" "}
                        <code>ChatMessagesCellContent</code> /{" "}
                        <code>TextCellContent</code>), hover popover via{" "}
                        <code>CellContentPopover</code> with full content + Copy
                        button, em-dash for null/undefined/empty,{" "}
                        <code>maxLines={"{10}"}</code> truncation in the cell
                        preview. Functional, just not type-aware (no chip) and
                        not dense (multi-line JSON dumps in the cell).
                        <br />
                        <br />
                        <strong>What's proposed on the right column:</strong>
                        <ul style={styles.notesList}>
                            <li>
                                <strong>gap-01</strong>: TypeChip on every cell.
                                Primitives (string/number/boolean) hide the chip
                                in <code>ambiguous-only</code> mode — value
                                rendering disambiguates the type. Click a chip
                                in the drawer or playground for type conversion;
                                table-cell chips are display-only here.
                            </li>
                            <li>
                                <strong>gap-02</strong>: structured cells render
                                as <code>chip + count + sample keys/values</code>{" "}
                                instead of multi-line JSON. ~2 lines tall
                                regardless of nested depth. The existing{" "}
                                <code>CellContentPopover</code> on hover still
                                shows the full structure. Stringified-JSON gets
                                its distinct <code>[json-str]</code> chip with
                                a "parse?" affordance and the popover shows the{" "}
                                <em>parsed</em> structure (production today
                                shows the raw escaped string).
                            </li>
                            <li>
                                <strong>gap-04</strong>: missing keys render as{" "}
                                <code>—</code>; the union-projected indicator
                                tells the user this column doesn't exist on this
                                row.
                            </li>
                            <li>
                                <strong>gap-05</strong>: literal-dot column
                                header gets <code>[dotted-key]</code>;
                                collision rows stack <code>[⚠ collision]</code>.
                            </li>
                            <li>
                                <strong>gap-06</strong>: messages-shaped arrays
                                show a chat preview (count + first role) instead
                                of raw JSON.
                            </li>
                        </ul>
                    </>
                }
                competitiveNotes={
                    <>
                        Braintrust renders cells as YAML preview (clean to depth
                        ~3, noisy at depth 5+); Langfuse renders multi-line JSON
                        inline. Both ship the gap-02/04 fault line — stringified
                        JSON shows literally with quotes intact, no chip
                        distinguishing it from a parsed value. Our{" "}
                        <code>[json-str]</code> chip is the differentiator. See{" "}
                        <a
                            href="../../../docs/designs/json-string-ux/competitive-analysis.md"
                            style={styles.link}
                        >
                            competitive-analysis.md
                        </a>{" "}
                        §2 + §13.
                    </>
                }
            >
                <div style={styles.toolbar}>
                    <span style={styles.toolbarLabel}>Chip mode:</span>
                    <Segmented
                        size="small"
                        value={chipMode}
                        options={[
                            {label: "All", value: "all"},
                            {label: "Ambiguous-only", value: "ambiguous-only"},
                            {label: "None", value: "none"},
                        ]}
                        onChange={(v) => setChipMode(v as ChipRenderMode)}
                    />
                    <span style={styles.toolbarHint}>
                        Same toggle as the drill-in and playground solution
                        pages — chip vocabulary decision propagates across
                        surfaces.
                    </span>
                </div>

                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={styles.thLabel}>Fixture</th>
                            <th style={styles.thGap}>Gap</th>
                            <th style={styles.thToday}>
                                Today · TestcaseCellContent
                            </th>
                            <th style={styles.thProposed}>
                                Proposed · ProposedTableCell
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {grid.map((cell) => (
                            <tr key={cell.label}>
                                <td style={styles.tdLabel}>
                                    <div style={styles.cellTitle}>{cell.label}</div>
                                    {cell.note ? (
                                        <div style={styles.cellNote}>{cell.note}</div>
                                    ) : null}
                                </td>
                                <td style={styles.tdGap}>
                                    {cell.gap ? (
                                        <span style={styles.gapPill}>{cell.gap}</span>
                                    ) : null}
                                </td>
                                <td style={styles.tdToday}>
                                    <TestcaseCellContent
                                        value={cell.value}
                                        maxLines={5}
                                    />
                                </td>
                                <td style={styles.tdProposed}>
                                    <ProposedTableCell
                                        value={cell.value}
                                        isMixedColumn={cell.flags?.mixed}
                                        isDottedKey={cell.flags?.dottedKey}
                                        isCollision={cell.flags?.collision}
                                        treatUndefinedAsMissing={cell.flags?.missing}
                                        chipMode={chipMode}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div style={styles.crossLinks}>
                    <strong>Other surfaces:</strong>{" "}
                    <Link href="/solutions-drill-in" style={styles.link}>
                        Solutions · Drill-in →
                    </Link>{" "}
                    ·{" "}
                    <Link href="/solutions-playground" style={styles.link}>
                        Solutions · Playground →
                    </Link>
                    <br />
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-02-table-cells" style={styles.link}>
                        gap-02
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-05-dot-key-disambiguation" style={styles.link}>
                        gap-05
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-06-messages-renderer" style={styles.link}>
                        gap-06
                    </Link>
                </div>
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
    toolbarLabel: {fontSize: 12, fontWeight: 600, color: "#051729"},
    toolbarHint: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.5,
        flex: 1,
        minWidth: 280,
    },
    link: {color: "#1677ff", fontWeight: 500},
    notesList: {margin: "8px 0", paddingLeft: 20, lineHeight: 1.7},
    table: {
        width: "100%",
        borderCollapse: "collapse" as const,
        fontSize: 12,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        overflow: "hidden" as const,
    },
    thLabel: {
        width: 200,
        padding: "10px 14px",
        fontSize: 11,
        textAlign: "left" as const,
        background: "#fafafa",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
        fontWeight: 600,
    },
    thGap: {
        width: 100,
        padding: "10px 14px",
        fontSize: 11,
        textAlign: "left" as const,
        background: "#fafafa",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
        fontWeight: 600,
    },
    thToday: {
        padding: "10px 14px",
        fontSize: 11,
        textAlign: "left" as const,
        background: "#fafafa",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.65)",
    },
    thProposed: {
        padding: "10px 14px",
        fontSize: 11,
        textAlign: "left" as const,
        background: "#f0f9ff",
        borderBottom: "1px solid rgba(22, 119, 255, 0.15)",
        fontWeight: 600,
        color: "#1677ff",
    },
    tdLabel: {
        padding: "12px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        verticalAlign: "top" as const,
    },
    tdGap: {
        padding: "12px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        verticalAlign: "top" as const,
    },
    tdToday: {
        padding: "12px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        borderRight: "1px solid rgba(5, 23, 41, 0.06)",
        verticalAlign: "top" as const,
        background: "rgba(5, 23, 41, 0.01)",
        minWidth: 240,
    },
    tdProposed: {
        padding: "12px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        verticalAlign: "top" as const,
        background: "#fdfeff",
        minWidth: 240,
    },
    cellTitle: {fontSize: 12, fontWeight: 600, color: "#051729"},
    cellNote: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.5)",
        marginTop: 2,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    gapPill: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 4,
        background: "rgba(22, 119, 255, 0.08)",
        color: "#1677ff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    crossLinks: {
        marginTop: 24,
        padding: "10px 14px",
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 8,
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.8,
    },
}
