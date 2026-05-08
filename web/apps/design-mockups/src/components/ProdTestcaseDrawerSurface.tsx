/**
 * ProdTestcaseDrawerSurface — replicates the production testcase drawer
 * chrome (header + body + footer) so the drill-in renders inside the same
 * frame users see in the real app. Mirrors:
 *
 *   web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer.tsx
 *
 * The header has the same elements:
 *   - Left:  close (»), up/down nav, "Testcase N" title, "edited" badge,
 *            copy ID button
 *   - Right: "Add to queue" button (purely visual here — no popover wiring),
 *            "Fields / JSON" Segmented toggle (production-faithful).
 *
 * The proposal columns can hide the chrome's edit-mode toggle via
 * `hideEditMode` — the design statement is that view-mode responsibility
 * moves *into* the drill-in (which exposes Fields / JSON / YAML on its own
 * root header), so a duplicate toggle in the chrome would be redundant.
 *
 * The body holds the drill-in content. The footer mirrors the production
 * drawer footer ("Cancel" + "Apply and Continue Editing" + dropdown caret).
 *
 * The frame width matches antd's `size="large"` default (736px) so the
 * whole panel reads like a real drawer rather than a column inside a grid.
 */

import {useState, type ReactNode} from "react"

import {CaretDoubleRight, CaretDown, CaretUp, Copy, ListChecks} from "@phosphor-icons/react"
import {Button, Dropdown, Segmented, Space, Tooltip} from "antd"

export type ProdDrawerEditMode = "fields" | "json"

interface ProdTestcaseDrawerSurfaceProps {
    /** Testcase number rendered in the title (matches "Testcase 12" pattern). */
    testcaseNumber?: number
    /** Show the blue "edited" badge next to the title. */
    edited?: boolean
    /** Controlled Fields / JSON toggle. When omitted the surface manages it locally. */
    editMode?: ProdDrawerEditMode
    onEditModeChange?: (mode: ProdDrawerEditMode) => void
    /**
     * Hide the chrome's Fields / JSON Segmented. Use in proposal columns
     * where the drill-in itself owns the view-mode toggle, so we don't
     * render two competing controls.
     */
    hideEditMode?: boolean
    children: ReactNode
}

export function ProdTestcaseDrawerSurface({
    testcaseNumber = 12,
    edited = false,
    editMode: controlledMode,
    onEditModeChange,
    hideEditMode = false,
    children,
}: ProdTestcaseDrawerSurfaceProps) {
    const [internalMode, setInternalMode] = useState<ProdDrawerEditMode>("fields")
    const editMode = controlledMode ?? internalMode

    const handleModeChange = (mode: ProdDrawerEditMode) => {
        if (controlledMode === undefined) {
            setInternalMode(mode)
        }
        onEditModeChange?.(mode)
    }

    return (
        <div style={styles.frame}>
            {/* Header — production layout (TestcaseEditDrawer.tsx :180–262) */}
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    <Button type="text" size="small" icon={<CaretDoubleRight size={14} />} />
                    <div style={styles.navGroup}>
                        <Button type="text" size="small" icon={<CaretUp size={14} />} />
                        <Button type="text" size="small" icon={<CaretDown size={14} />} />
                    </div>
                    <span style={styles.title}>Testcase {testcaseNumber}</span>
                    {edited ? <span style={styles.editedBadge}>edited</span> : null}
                    <Tooltip title="Copy ID">
                        <Button type="text" size="small" icon={<Copy size={14} />} />
                    </Tooltip>
                </div>
                <div style={styles.headerRight}>
                    <Button size="small" icon={<ListChecks size={14} />}>
                        Add to queue
                    </Button>
                    {hideEditMode ? null : (
                        <Segmented
                            size="small"
                            value={editMode}
                            onChange={(value) => handleModeChange(value as ProdDrawerEditMode)}
                            options={[
                                {label: "Fields", value: "fields"},
                                {label: "JSON", value: "json"},
                            ]}
                        />
                    )}
                </div>
            </header>

            {/* Body — drill-in or JSON editor lives here. Padding 0 so the
                inner [&_.drill-in-field-content]:px-4 selector lands. */}
            <div style={styles.body}>{children}</div>

            {/* Footer — production has Cancel + Apply split-button. Disabled
                here because the surface is presentational; we keep the visual
                so the chrome reads correctly. */}
            <footer style={styles.footer}>
                <Button>Cancel</Button>
                <Space.Compact>
                    <Button type="primary" disabled={!edited}>
                        Apply and Continue Editing
                    </Button>
                    <Dropdown
                        placement="topRight"
                        menu={{
                            items: [{key: "commit", label: "Apply and Commit Changes"}],
                        }}
                    >
                        <Button type="primary" icon={<CaretUp size={14} />} disabled={!edited} />
                    </Dropdown>
                </Space.Compact>
            </footer>
        </div>
    )
}

const PROD_DRAWER_WIDTH = 736

const styles = {
    frame: {
        // Match antd Drawer `size="large"` default width so the surface
        // visually reads as a production drawer panel rather than a generic
        // card inside a comparison grid.
        width: PROD_DRAWER_WIDTH,
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column" as const,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow:
            "0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        background: "white",
        flexShrink: 0,
    },
    headerLeft: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        flex: 1,
    },
    navGroup: {
        display: "flex",
        alignItems: "center",
    },
    title: {
        fontSize: 14,
        fontWeight: 500,
        color: "#051729",
        marginLeft: 4,
        whiteSpace: "nowrap" as const,
    },
    editedBadge: {
        fontSize: 10,
        fontWeight: 500,
        background: "#dbeafe",
        color: "#1d4ed8",
        padding: "2px 6px",
        borderRadius: 4,
        marginLeft: 4,
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
        background: "white",
        minHeight: 480,
        padding: 0,
    },
    footer: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 12,
        padding: "12px 24px",
        borderTop: "1px solid rgba(5, 23, 41, 0.06)",
        background: "white",
        flexShrink: 0,
    },
}

export default ProdTestcaseDrawerSurface
