/**
 * Solutions · Tables — unified testset cell demo (mid-fidelity rebuild).
 *
 * Mounts a real antd `<Table>` with production's `groupColumns` utility +
 * production's `TestcaseCellContent` renderer for the Today panel and our
 * `ProposedTableCell` renderer for the Proposed panel. Same data source,
 * same column grouping, two cell renderers. The diff is the cell
 * rendering, nothing else.
 *
 * What's REAL production code in use here:
 *   - groupColumns (web/oss/.../utils/groupColumns.ts)
 *   - TestcaseCellContent (web/oss/.../components/TestcaseCellContent.tsx)
 *   - antd Table (column-grouping rendering)
 *
 * What's NOT production:
 *   - The entity atom layer (testset / testcase / revisions / metadata)
 *     is not seeded; we don't drive InfiniteVirtualTable or the
 *     TestcasesTableShell directly. Stub data flows through helpers in
 *     testsetTableHelpers.ts that simulate the union-and-flatten logic
 *     the entity does for real.
 */

import {useEffect, useMemo, useState} from "react"

import Head from "next/head"
import Link from "next/link"

import {Segmented, Table} from "antd"
import type {ColumnType} from "antd/es/table"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"
import {ProposedTableCell} from "@/mockups/components/proposed/ProposedTableCell"
import {type ChipRenderMode} from "@/mockups/components/proposed/ProposedDrillIn"
import {TypeChip} from "@/mockups/components/proposed/TypeChip"
import {
    computeColumns,
    detectCollisionColumns,
    detectColumnTypes,
    detectDottedKeyColumns,
    detectMixedColumns,
    detectStringifiedExpandableColumns,
    flattenRow,
    getNestedValue,
    type ColumnTypeChip,
    type FlatRow,
    type StubRow,
} from "@/mockups/components/proposed/testsetTableHelpers"
import {
    fixture02_capitals_with_geo,
    fixture07_messages_and_tools,
    fixture08_dot_key_collision,
    fixture_kitchen_sink,
} from "@/mockups/data/stubTestcases"
import {groupColumns} from "@/oss/components/TestcasesTableNew/utils/groupColumns"
import TestcaseCellContent from "@/oss/components/TestcasesTableNew/components/TestcaseCellContent"

// Toggle to bring back the multi-testset switcher. Kept as a flag (rather
// than deleting the focused testsets) so they're one edit away if a
// targeted review is needed.
const SHOW_TESTSET_SWITCHER = false

// Multi-row testsets for the table demo. Each one exercises a different
// column-shape problem so the demo isn't single-row.
const TESTSETS: {
    id: string
    label: string
    rows: StubRow[]
    note: string
}[] = [
    {
        id: "kitchen-sink",
        label: "Kitchen sink — every gap (3 rows)",
        rows: fixture_kitchen_sink.map((tc) => ({
            id: tc.id,
            label: tc.label,
            data: tc.data,
        })),
        note: "Single testset that exercises every table-side gap. Vanuatu (row 1) authors every column — nested `inputs`/`outputs`/`geo` expand into sub-column groups (production behavior); `metadata` is stringified-JSON ([json-str] chip + parsed popover); literal `\"geo.region\"` collides with nested `geo > region` ([dotted-key] + [⚠ collision]); `messages` includes a tool_calls turn ([msgs] + [tool] chips). Tuvalu (row 2) and Kiribati (row 3) miss some of those columns — em-dash on the cell. The `notes` column varies in type across rows (null / string / object) → [mixed] chip on the column header.",
    },
    {
        id: "02-nested",
        label: "02 nested-native (3 rows)",
        rows: fixture02_capitals_with_geo.map((tc) => ({
            id: tc.id,
            label: tc.label,
            data: tc.data,
        })),
        note: "Homogeneous nested objects (`inputs`, `outputs`) — production's column grouping expands them into sub-column groups. Try collapsing `outputs` via the group header.",
    },
    {
        id: "08-collision",
        label: "08 dot-key collision (3 rows)",
        rows: fixture08_dot_key_collision.map((tc) => ({
            id: tc.id,
            label: tc.label,
            data: tc.data,
        })),
        note: "Vanuatu has both literal `\"geo.region\"` AND nested `geo.region`. The literal column gets `[dotted-key]` + `[⚠ collision]`; the expanded `geo > region` sub-column also gets `[⚠ collision]`. Other rows render the literal cell as `—` (gap-04 not-authored).",
    },
    {
        id: "07-messages",
        label: "07 messages + tools (3 rows)",
        rows: fixture07_messages_and_tools.map((tc) => ({
            id: tc.id,
            label: tc.label,
            data: tc.data,
        })),
        note: "Each row has a `messages` array and an `outputs` object with `tool_calls`. Today: `ChatMessagesCellContent` renders chat preview already. Proposed: adds `[msgs]` chip + count.",
    },
]

export default function SolutionsTables() {
    const [testsetId, setTestsetId] =
        useState<(typeof TESTSETS)[number]["id"]>("kitchen-sink")
    const [chipMode, setChipMode] = useState<ChipRenderMode>("all")
    // Shared collapsed-group state across both panels so the demo shows the
    // same column layout on each side (production parity). Defaults to
    // empty (everything expanded); user clicks group headers to collapse.
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
        () => new Set(),
    )
    // gap-02 parse-on-detect — top-level stringified-JSON columns the user
    // has opted to expand. A column starts here as a flat [json-str] cell;
    // clicking the [json-str] chip on the header adds it to this set,
    // which makes computeColumns parse the string and emit sub-columns.
    // Clicking the caret on the resulting group removes it again.
    const [parsedStringifiedColumns, setParsedStringifiedColumns] = useState<
        Set<string>
    >(() => new Set())

    const active = TESTSETS.find((t) => t.id === testsetId) ?? TESTSETS[0]

    // Reset collapsed-group state when the testset changes — fresh testsets
    // have different group paths, so stale entries would silently persist.
    useEffect(() => {
        setCollapsedGroups(new Set())
        setParsedStringifiedColumns(new Set())
    }, [testsetId])

    const toggleGroupCollapse = (groupPath: string) => {
        // If this is a parsed-stringified column at the root, "collapse"
        // means un-parse it (remove from the parsed set). Otherwise it's
        // a normal nested-object group → toggle in collapsedGroups.
        if (parsedStringifiedColumns.has(groupPath)) {
            setParsedStringifiedColumns((prev) => {
                const next = new Set(prev)
                next.delete(groupPath)
                return next
            })
            return
        }
        setCollapsedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(groupPath)) next.delete(groupPath)
            else next.add(groupPath)
            return next
        })
    }

    const expandStringifiedColumn = (key: string) => {
        setParsedStringifiedColumns((prev) => {
            if (prev.has(key)) return prev
            const next = new Set(prev)
            next.add(key)
            return next
        })
    }

    // Column union + nested expansion. Same logic the production entity
    // layer does, just running off stub data instead of atoms.
    const columns = useMemo(
        () => computeColumns(active.rows, parsedStringifiedColumns),
        [active.rows, parsedStringifiedColumns],
    )
    const stringifiedExpandableColumns = useMemo(
        () => detectStringifiedExpandableColumns(active.rows),
        [active.rows],
    )
    const flatRows = useMemo(
        () => active.rows.map((r) => flattenRow(r, columns)),
        [active.rows, columns],
    )
    const mixedColumns = useMemo(
        () => detectMixedColumns(flatRows, columns),
        [flatRows, columns],
    )
    const collisionColumns = useMemo(
        () => detectCollisionColumns(active.rows, columns),
        [active.rows, columns],
    )
    const dottedKeyColumns = useMemo(
        () => detectDottedKeyColumns(columns),
        [columns],
    )
    const columnTypes = useMemo(
        () => detectColumnTypes(flatRows, columns, mixedColumns),
        [flatRows, columns, mixedColumns],
    )

    // Group header renderer — shared between Today and Proposed so both
    // panels show the same caret affordance + click-to-toggle. Mirrors
    // production's TestcasesTableShell.tsx:449. When the group corresponds
    // to a parsed-stringified column, an extra [json-str] chip stacks
    // alongside the name so the user can see the column came from a
    // string (not a real nested object) and can click the caret to fold.
    const renderGroupHeader = (
        groupPath: string,
        isCollapsed: boolean,
        childCount: number,
    ) => {
        const displayName = groupPath.includes(".")
            ? groupPath.substring(groupPath.lastIndexOf(".") + 1)
            : groupPath
        const isParsedStringified = parsedStringifiedColumns.has(groupPath)
        return (
            <span style={styles.proposedHeader}>
                <span
                    style={styles.groupHeader}
                    onClick={(e) => {
                        e.stopPropagation()
                        toggleGroupCollapse(groupPath)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            toggleGroupCollapse(groupPath)
                        }
                    }}
                >
                    <span style={styles.groupCaret}>
                        {isCollapsed ? "▸" : "▾"}
                    </span>
                    <span style={styles.groupName}>{displayName}</span>
                    <span style={styles.groupCount}>({childCount})</span>
                </span>
                {isParsedStringified && chipMode !== "none" ? (
                    <TypeChip variant="stringified" />
                ) : null}
            </span>
        )
    }

    // Today's column defs — render via production's TestcaseCellContent.
    const todayColumns = useMemo(
        () =>
            groupColumns<FlatRow>(
                columns,
                (col, displayName) => ({
                    key: col.key,
                    dataIndex: col.key,
                    title: <span style={styles.todayHeader}>{displayName}</span>,
                    width: 220,
                    render: (value: unknown) => (
                        <TestcaseCellContent value={value} maxLines={6} />
                    ),
                }),
                {
                    // maxDepth=5 lets groupColumns expand all the way down
                    // through `geo > coordinates > lat / lng / altitude_m` by
                    // default. Production's default is 1 (depth-limited
                    // groups collapse on render); for the demo we want full
                    // visibility so chips appear on every leaf.
                    maxDepth: 5,
                    collapsedGroups,
                    onGroupHeaderClick: toggleGroupCollapse,
                    renderGroupHeader,
                    createCollapsedColumnDef: (groupPath) => ({
                        key: groupPath,
                        dataIndex: groupPath,
                        title: (
                            <span
                                style={styles.collapsedHeader}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    toggleGroupCollapse(groupPath)
                                }}
                                role="button"
                                tabIndex={0}
                            >
                                <span style={styles.groupCaret}>▸</span>
                                <span style={styles.groupName}>
                                    {groupPath.includes(".")
                                        ? groupPath.substring(
                                              groupPath.lastIndexOf(".") + 1,
                                          )
                                        : groupPath}
                                </span>
                            </span>
                        ),
                        width: 220,
                        // When collapsed, render the parent object's full
                        // value for that row — walk the nested path on
                        // `record._data` since collapsed groups can be
                        // multiple levels deep (e.g. `geo.coordinates`).
                        render: (_value: unknown, record: FlatRow) => (
                            <TestcaseCellContent
                                value={getNestedValue(
                                    record._data,
                                    groupPath.split("."),
                                )}
                                maxLines={6}
                            />
                        ),
                    }),
                },
            ),
        [columns, collapsedGroups, parsedStringifiedColumns],
    )

    // Proposed column defs — same data, ProposedTableCell renderer.
    // Column header gets a per-column type chip (gap-01, all mode) plus
    // correctness chips (mixed / dotted-key) when applicable. Group
    // headers are click-to-collapse via shared `collapsedGroups` state.
    // When a column is a stringified-JSON-eligible top-level column, the
    // [json-str] chip is clickable — clicking it parses the column and
    // re-emits as a sub-column group (gap-02 parse-on-detect).
    const proposedColumns = useMemo(
        () =>
            groupColumns<FlatRow>(
                columns,
                (col, displayName) => {
                    const isMixed = mixedColumns.has(col.key)
                    const isDottedKey = dottedKeyColumns.has(col.key)
                    const colType = columnTypes.get(col.key)
                    const showColumnTypeChip =
                        chipMode === "all" && colType !== undefined && !isMixed
                    // The [json-str] chip on a top-level stringified column
                    // is interactive — click parses the column. Other type
                    // chips are static.
                    const isStringifiedExpandable =
                        col.parentKey === undefined &&
                        stringifiedExpandableColumns.has(col.key)
                    const isStringifiedClickable =
                        showColumnTypeChip &&
                        colType === "stringified" &&
                        isStringifiedExpandable
                    return {
                        key: col.key,
                        dataIndex: col.key,
                        title: (
                            <div style={styles.proposedHeader}>
                                <span style={styles.proposedHeaderName}>
                                    {displayName}
                                </span>
                                {showColumnTypeChip ? (
                                    <TypeChip
                                        variant={colType as ColumnTypeChip}
                                        onClick={
                                            isStringifiedClickable
                                                ? () =>
                                                      expandStringifiedColumn(
                                                          col.key,
                                                      )
                                                : undefined
                                        }
                                        ariaLabel={
                                            isStringifiedClickable
                                                ? `Parse ${col.key} into sub-columns`
                                                : undefined
                                        }
                                    />
                                ) : null}
                                {isDottedKey && chipMode !== "none" ? (
                                    <TypeChip variant="dotted-key" />
                                ) : null}
                                {isMixed && chipMode !== "none" ? (
                                    <TypeChip variant="mixed" />
                                ) : null}
                            </div>
                        ),
                        width: 220,
                        render: (value: unknown) => (
                            <ProposedTableCell
                                value={value}
                                isMixedColumn={isMixed}
                                isDottedKey={isDottedKey}
                                isCollision={collisionColumns.has(col.key)}
                                treatUndefinedAsMissing
                                chipMode={chipMode}
                            />
                        ),
                    }
                },
                {
                    // Same maxDepth as the today panel so both render the
                    // full geo > coordinates > lat/lng/altitude_m hierarchy.
                    maxDepth: 5,
                    collapsedGroups,
                    onGroupHeaderClick: toggleGroupCollapse,
                    renderGroupHeader,
                    createCollapsedColumnDef: (groupPath) => ({
                        key: groupPath,
                        dataIndex: groupPath,
                        title: (
                            <div style={styles.proposedHeader}>
                                <span
                                    style={styles.collapsedHeader}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        toggleGroupCollapse(groupPath)
                                    }}
                                    role="button"
                                    tabIndex={0}
                                >
                                    <span style={styles.groupCaret}>▸</span>
                                    <span style={styles.groupName}>
                                        {groupPath.includes(".")
                                            ? groupPath.substring(
                                                  groupPath.lastIndexOf(".") + 1,
                                              )
                                            : groupPath}
                                    </span>
                                </span>
                                {chipMode !== "none" && (
                                    <TypeChip variant="json-object" />
                                )}
                            </div>
                        ),
                        width: 220,
                        render: (_value: unknown, record: FlatRow) => (
                            <ProposedTableCell
                                value={getNestedValue(
                                    record._data,
                                    groupPath.split("."),
                                )}
                                treatUndefinedAsMissing
                                chipMode={chipMode}
                            />
                        ),
                    }),
                },
            ) as ColumnType<FlatRow>[],
        [
            columns,
            mixedColumns,
            dottedKeyColumns,
            collisionColumns,
            columnTypes,
            chipMode,
            collapsedGroups,
            parsedStringifiedColumns,
            stringifiedExpandableColumns,
        ],
    )

    return (
        <>
            <Head>
                <title>Solutions · Tables — unified testset cell demo</title>
            </Head>
            <MockupPageShell
                title="Solutions · Tables (testset cells)"
                blurb={
                    "Real antd Table on both sides, driven by the same multi-row stub testset. Production's groupColumns utility computes the column-grouping (homogeneous nested objects expand into sub-column groups). Today panel uses production's TestcaseCellContent (popover, syntax highlighting, chat preview, em-dash). Proposed panel uses ProposedTableCell (chips, count, sample preview) plus correctness chips on column headers."
                }
                notes={
                    <>
                        <strong>What's real production code:</strong>
                        <ul style={styles.notesList}>
                            <li>
                                <code>groupColumns</code> (
                                <code>
                                    web/oss/.../utils/groupColumns.ts
                                </code>
                                ) — the same utility that drives the live
                                testset table's column grouping. Takes a flat
                                column list, returns nested antd column defs.
                                Sub-columns under group headers (
                                <code>inputs &gt; country</code>) collapse on
                                click, recursively.
                            </li>
                            <li>
                                <code>TestcaseCellContent</code> (
                                <code>
                                    web/oss/.../components/TestcaseCellContent.tsx
                                </code>
                                ) — production's cell renderer with{" "}
                                <code>CellContentPopover</code>,{" "}
                                <code>JsonCellContent</code>,{" "}
                                <code>ChatMessagesCellContent</code>, em-dash
                                for null/undefined/empty.
                            </li>
                            <li>
                                Antd <code>Table</code> handles the rendering,
                                column header virtualization, header sticky
                                behavior. Same Table component production uses
                                inside <code>InfiniteVirtualTable</code>.
                            </li>
                        </ul>
                        <br />
                        <strong>What's NOT real production:</strong> the
                        entity atom layer isn't seeded, so we don't mount{" "}
                        <code>InfiniteVirtualTable</code> /{" "}
                        <code>TestcasesTableShell</code> directly. Stub data
                        flows through{" "}
                        <code>testsetTableHelpers.ts</code> which simulates
                        the union-and-flatten step the entity does in real
                        life. Virtual scrolling isn't exercised (3-row demo
                        doesn't need it).
                        <br />
                        <br />
                        <strong>What's proposed on the right column:</strong>
                        <ul style={styles.notesList}>
                            <li>
                                <strong>gap-01</strong>: <code>TypeChip</code>{" "}
                                on every cell (or hidden in{" "}
                                <code>ambiguous-only</code> mode for
                                primitives).
                            </li>
                            <li>
                                <strong>gap-02</strong>: dense{" "}
                                <code>chip + count + sample keys</code>{" "}
                                preview for objects/arrays instead of
                                multi-line JSON dump.
                            </li>
                            <li>
                                <strong>gap-04</strong>: missing keys render
                                as <code>—</code> (production already does
                                this for empty/null; the proposed marker is
                                conceptually distinct from production's
                                em-dash but renders the same way).
                            </li>
                            <li>
                                <strong>gap-05</strong>: dotted-key + collision
                                chips on the column header (literal-dot keys
                                like <code>&quot;geo.region&quot;</code>) and
                                on cells where collision detected.
                            </li>
                            <li>
                                <strong>gap-02 [mixed]</strong>: heterogeneous
                                column types across rows surface the{" "}
                                <code>[mixed]</code> chip on the column
                                header.
                            </li>
                            <li>
                                <strong>gap-06</strong>: production already
                                has <code>ChatMessagesCellContent</code>; the
                                Proposed cell adds the <code>[msgs]</code>{" "}
                                chip + count summary.
                            </li>
                        </ul>
                    </>
                }
            >
                <div style={styles.toolbar}>
                    {/* Testset switcher hidden — kitchen-sink testset covers every
                        gap on a single 3-row testset. Re-enable by setting
                        SHOW_TESTSET_SWITCHER=true. */}
                    {SHOW_TESTSET_SWITCHER ? (
                        <>
                            <span style={styles.label}>Testset:</span>
                            <Segmented
                                size="small"
                                value={testsetId}
                                options={TESTSETS.map((t) => ({
                                    label: t.label,
                                    value: t.id,
                                }))}
                                onChange={(v) =>
                                    setTestsetId(
                                        v as (typeof TESTSETS)[number]["id"],
                                    )
                                }
                            />
                            <span style={styles.divider} />
                        </>
                    ) : null}
                    <span style={styles.label}>Chip mode:</span>
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
                </div>
                <div style={styles.note}>{active.note}</div>

                <div style={styles.tableSection}>
                    <div style={styles.tableHeaderRow}>
                        <div style={styles.tableLabel}>
                            <span style={styles.todayPill}>Today</span>
                            <span style={styles.tableLabelSub}>
                                Production · TestcaseCellContent +
                                groupColumns
                            </span>
                        </div>
                    </div>
                    <Table<FlatRow>
                        columns={todayColumns}
                        dataSource={flatRows}
                        rowKey="id"
                        pagination={false}
                        size="small"
                        bordered
                        scroll={{x: "max-content"}}
                    />
                </div>

                <div style={styles.tableSection}>
                    <div style={styles.tableHeaderRow}>
                        <div style={styles.tableLabel}>
                            <span style={styles.proposedPill}>Proposed</span>
                            <span style={styles.tableLabelSub}>
                                ProposedTableCell + chip-aware column headers
                                + same groupColumns
                            </span>
                        </div>
                    </div>
                    <Table<FlatRow>
                        columns={proposedColumns}
                        dataSource={flatRows}
                        rowKey="id"
                        pagination={false}
                        size="small"
                        bordered
                        scroll={{x: "max-content"}}
                    />
                </div>

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
    label: {fontSize: 12, fontWeight: 600, color: "#051729"},
    divider: {width: 1, height: 20, background: "rgba(5, 23, 41, 0.12)"},
    note: {
        marginBottom: 16,
        padding: "10px 14px",
        background: "#fffbe6",
        borderLeft: "3px solid #faad14",
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.6,
        borderRadius: "0 4px 4px 0",
    },
    link: {color: "#1677ff", fontWeight: 500},
    notesList: {margin: "8px 0", paddingLeft: 20, lineHeight: 1.7},
    tableSection: {
        marginBottom: 24,
    },
    tableHeaderRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 8,
    },
    tableLabel: {
        display: "flex",
        alignItems: "center",
        gap: 10,
    },
    todayPill: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: "rgba(5, 23, 41, 0.06)",
        color: "rgba(5, 23, 41, 0.65)",
    },
    proposedPill: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: "#f0f9ff",
        color: "#1677ff",
    },
    tableLabelSub: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
    },
    todayHeader: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
        whiteSpace: "nowrap" as const,
    },
    proposedHeader: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap" as const,
    },
    proposedHeaderName: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
    },
    groupHeader: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
        userSelect: "none" as const,
    },
    collapsedHeader: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
        userSelect: "none" as const,
    },
    groupCaret: {
        display: "inline-block",
        width: 10,
        textAlign: "center" as const,
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
    },
    groupName: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
    },
    groupCount: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.45)",
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
