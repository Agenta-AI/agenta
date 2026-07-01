/**
 * ConfigItemDrawer
 *
 * The shared item-config drawer chrome from the agent playground design (PKG-01): a
 * right-hand drawer whose header carries the item identity (icon, name, a type badge and a
 * one-line subtitle) and a Form ↔ JSON view toggle, and whose body switches between a
 * structured form and a raw JSON editor of the same item.
 *
 * Editing happens on a draft the host owns; the drawer commits it via the footer **Save**
 * (labelled "Create" for a new item) and discards it via **Cancel** / the close button. So an
 * in-progress edit never touches the config until the user confirms.
 *
 * Built on the shared `EnhancedDrawer` (`@agenta/ui/drawer`) so all app drawers migrate
 * through a single component. This component is pure chrome — the per-item business logic lives
 * in the `form` content component the host passes (ToolFormView / McpServerFormView /
 * SkillFormView). That content is mounted lazily: `EnhancedDrawer` does not render its children
 * until first opened, and `destroyOnClose` unmounts them again on close — so a content
 * component's hooks/queries never run until the user actually opens the drawer.
 *
 * Used for tools and MCP servers today; the chrome is item-agnostic so other config item
 * types can reuse it.
 */
import {type ReactNode} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Segmented, Tag} from "antd"

export type ConfigItemView = "form" | "json"

export interface ConfigItemDrawerProps {
    open: boolean
    /** Whether the drawer is creating a new item or editing an existing one (labels Save). */
    mode: "create" | "edit"
    /** Item title shown in the header. */
    title: ReactNode
    /** Leading icon shown before the title. */
    icon?: ReactNode
    /** Type badge shown next to the title (e.g. "definition", "MCP server"). */
    badge?: {text: ReactNode; color?: string}
    /** One-line description of the item type, shown muted under the title. */
    subtitle?: ReactNode
    /** Muted note shown on the left of the footer (e.g. the item's scope). */
    footerNote?: ReactNode
    /** Current view. */
    view: ConfigItemView
    /** Called when the user flips the Form/JSON toggle. */
    onViewChange: (view: ConfigItemView) => void
    /** Discard the draft and dismiss the drawer (Cancel / close button). */
    onCancel: () => void
    /** Commit the draft to the config. */
    onSave: () => void
    /** Disable the Save/Create action (e.g. the draft is missing a required field). */
    saveDisabled?: boolean
    /** Form-view body. */
    form: ReactNode
    /** JSON-view body. */
    json: ReactNode
    /** Hide the Form/JSON toggle and show JSON only (e.g. items with no structured form). */
    jsonOnly?: boolean
    /** Drawer width in px. @default 600 */
    width?: number
    /** Read-only mode: disables the toggle and the Save action. */
    disabled?: boolean
    /**
     * Full-bleed body: drops the default 16px padding and makes the body a full-height flex column
     * so a form can lay out its own edge-to-edge master/detail (e.g. the tool parameter editor).
     * The JSON view keeps its padding regardless. @default false
     */
    contentFlush?: boolean
}

export function ConfigItemDrawer({
    open,
    mode,
    title,
    icon,
    badge,
    subtitle,
    footerNote,
    view,
    onViewChange,
    onCancel,
    onSave,
    saveDisabled = false,
    form,
    json,
    jsonOnly = false,
    width = 600,
    disabled = false,
    contentFlush = false,
}: ConfigItemDrawerProps) {
    const effectiveView = jsonOnly ? "json" : view
    // Flush layout only helps the form; keep the JSON editor padded and independently scrollable.
    const flushForm = contentFlush && effectiveView === "form"

    return (
        <EnhancedDrawer
            open={open}
            onClose={onCancel}
            placement="right"
            width={width}
            // Explicit Cancel/Save only — an outside click must not silently drop the draft.
            closeOnLayoutClick={false}
            // Lazy content: children aren't mounted until first open and are torn down on close,
            // so the content component's logic only runs while the drawer is open.
            destroyOnClose
            title={
                <div className="flex min-w-0 items-center gap-2">
                    {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">{title}</span>
                            {badge ? (
                                <Tag
                                    color={badge.color}
                                    className="m-0 shrink-0 text-[11px] font-normal"
                                >
                                    {badge.text}
                                </Tag>
                            ) : null}
                        </div>
                        {subtitle ? (
                            <div className="truncate text-xs font-normal text-[var(--ag-c-97A4B0,#97a4b0)]">
                                {subtitle}
                            </div>
                        ) : null}
                    </div>
                </div>
            }
            extra={
                jsonOnly ? null : (
                    <Segmented
                        value={effectiveView}
                        onChange={(v) => onViewChange(v as ConfigItemView)}
                        options={[
                            {label: "Form", value: "form"},
                            {label: "JSON", value: "json"},
                        ]}
                        disabled={disabled}
                    />
                )
            }
            footer={
                <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        {footerNote}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button onClick={onCancel}>Cancel</Button>
                        <Button type="primary" onClick={onSave} disabled={disabled || saveDisabled}>
                            {mode === "create" ? "Create" : "Save"}
                        </Button>
                    </div>
                </div>
            }
            styles={{
                body: flushForm
                    ? {
                          padding: 0,
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                      }
                    : {padding: 16},
            }}
        >
            {effectiveView === "form" ? (
                form
            ) : contentFlush ? (
                <div className="h-full overflow-auto p-4">{json}</div>
            ) : (
                json
            )}
        </EnhancedDrawer>
    )
}
