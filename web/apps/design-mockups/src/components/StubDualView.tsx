/**
 * StubDualView — composes the Fields ↔ JSON segmented toggle that
 * EntityDualViewEditor exposes, but without the production entity / molecule /
 * OSS state graph plumbing.
 *
 * Used for gap-04 (shape preservation) where the production
 * EntityDualViewEditor wants a writable `selectors.data(id)` atom — but the
 * testcase entity exposes that as a derived (read-only) atom, so direct seeds
 * leave the data null and the editor renders nothing. This composition gives
 * us the same visual surface (DrillInContent for Fields, JsonEditorWithLocalState
 * for JSON, segmented toggle for the switch) without the seed problem.
 *
 * The "as authored" / "all columns (N)" toggle on the JSON view is the
 * gap-04 proposal — bound to a local boolean here so we can demo the
 * projection difference without touching the OSS save path.
 */

import {useMemo, useState} from "react"

import {JsonEditorWithLocalState} from "@/oss/components/DrillInView/JsonEditorWithLocalState"
import {Segmented} from "antd"

import {StubDrillIn} from "./StubDrillIn"

interface Column {
    key: string
    label?: string
}

interface StubDualViewProps {
    initialData: Record<string, unknown>
    /**
     * Union of column keys across the testset. JSON view's "all columns" mode
     * will project these as empty strings if the row didn't author them — the
     * exact behavior gap-04 calls out (EntityDualViewEditor.tsx:144–155).
     */
    unionColumns: Column[]
    rootTitle?: string
    editable?: boolean
}

type EditMode = "fields" | "json"
type JsonProjection = "as-authored" | "all-columns"

export function StubDualView({
    initialData,
    unionColumns,
    rootTitle = "Testcase",
    editable = true,
}: StubDualViewProps) {
    const [mode, setMode] = useState<EditMode>("fields")
    const [projection, setProjection] = useState<JsonProjection>("as-authored")
    const [data, setData] = useState<Record<string, unknown>>(initialData)

    const projectedJson = useMemo(() => {
        if (projection === "as-authored") {
            return JSON.stringify(data, null, 2)
        }
        const projected: Record<string, unknown> = {...data}
        for (const col of unionColumns) {
            if (projected[col.key] === undefined) {
                projected[col.key] = ""
            }
        }
        return JSON.stringify(projected, null, 2)
    }, [data, projection, unionColumns])

    const projectedKeyCount = useMemo(() => {
        const ownKeys = new Set(Object.keys(data))
        return unionColumns.filter((col) => !ownKeys.has(col.key)).length
    }, [data, unionColumns])

    return (
        <div style={styles.wrapper}>
            <header style={styles.toolbar}>
                <Segmented
                    options={[
                        {label: "Fields", value: "fields"},
                        {label: "JSON", value: "json"},
                    ]}
                    value={mode}
                    onChange={(value) => setMode(value as EditMode)}
                    size="small"
                />
                {mode === "json" ? (
                    <div style={styles.toolbarRight}>
                        <Segmented
                            options={[
                                {label: "As authored", value: "as-authored"},
                                {
                                    label: `All columns (+${projectedKeyCount} projected)`,
                                    value: "all-columns",
                                },
                            ]}
                            value={projection}
                            onChange={(value) =>
                                setProjection(value as JsonProjection)
                            }
                            size="small"
                        />
                        <span style={styles.toolbarHint}>
                            {projection === "as-authored"
                                ? "Matches BE storage. JSON-edit save would only diff against authored data."
                                : "Materializes the column union with empty fallbacks. Today's default."}
                        </span>
                    </div>
                ) : null}
            </header>

            <div style={styles.body}>
                {mode === "fields" ? (
                    <StubDrillIn
                        initialData={data}
                        rootTitle={rootTitle}
                        editable={editable}
                        showFieldDrillIn
                        showFieldCollapse
                        enableFieldViewModes
                        onChange={setData}
                    />
                ) : (
                    <JsonEditorWithLocalState
                        initialValue={projectedJson}
                        editorKey={`stub-dual-${rootTitle}-${projection}`}
                        onValidChange={(next) => {
                            try {
                                const parsed = JSON.parse(next ?? "{}")
                                if (parsed && typeof parsed === "object") {
                                    setData(parsed as Record<string, unknown>)
                                }
                            } catch {
                                // ignore — invalid JSON, leave data unchanged
                            }
                        }}
                        readOnly={!editable}
                    />
                )}
            </div>
        </div>
    )
}

const styles = {
    wrapper: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 12,
    },
    toolbar: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap" as const,
    },
    toolbarRight: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginLeft: "auto",
    },
    toolbarHint: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
        maxWidth: 280,
        lineHeight: 1.5,
    },
    body: {
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 6,
        padding: 12,
        minHeight: 320,
    },
}

export default StubDualView
