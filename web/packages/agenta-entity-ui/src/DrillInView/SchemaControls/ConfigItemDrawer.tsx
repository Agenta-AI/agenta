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
 * Built on the kit `Sheet`. This component is pure chrome — the per-item business logic lives
 * in the `form` content component the host passes (ToolFormView / McpServerFormView /
 * SkillFormView). That content is mounted lazily: the sheet content mounts only while the drawer
 * is open and unmounts after it closes — so a content component's hooks/queries never run until
 * the user actually opens the drawer.
 *
 * Used for tools and MCP servers today; the chrome is item-agnostic so other config item
 * types can reuse it.
 */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {cn} from "@agenta/ui/styles"
import {
    Badge,
    type BadgeProps,
    Button,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"

import {DeferredBody, FormDrawerSkeleton} from "./DrawerSkeletons"

// The badge `color` is an antd preset hue name supplied by the item-kind descriptors
// (`typeColor: "cyan" | "blue" | …`), which type it as a plain string — so resolve it to a Badge
// variant here rather than casting, and fall back to the neutral chip for an unknown hue.
const BADGE_VARIANTS = [
    "blue",
    "green",
    "orange",
    "red",
    "purple",
    "cyan",
    "magenta",
    "pink",
    "yellow",
    "volcano",
    "geekblue",
    "lime",
    "gold",
] as const

function badgeVariantFor(color: string | undefined): BadgeProps["variant"] {
    return (BADGE_VARIANTS as readonly string[]).includes(color ?? "")
        ? (color as BadgeProps["variant"])
        : "default"
}

export interface ConfigItemDrawerProps {
    open: boolean
    /** Whether the drawer is creating a new item or editing an existing one (labels Save). */
    mode: "create" | "edit"
    /** Item title shown in the header. */
    title: ReactNode
    /** Type badge shown next to the title (e.g. "definition", "MCP server"). */
    badge?: {text: ReactNode; color?: string}
    /** One-line description of the item type, shown muted under the title. */
    subtitle?: ReactNode
    /** Muted note shown on the left of the footer (e.g. the item's scope). */
    footerNote?: ReactNode
    /** Why the last Save failed. Replaces the footer note until the next Save. */
    error?: ReactNode
    /** Save is in flight (an item whose save does async work before it commits). */
    saving?: boolean
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
    /** Show the raw JSON instead of the form, for an item with no structured form. */
    jsonOnly?: boolean
    /** Header action, for an item with an action of its own (a subagent's "Open agent" link). */
    headerExtra?: ReactNode
    /** Drawer width in px. @default 600 */
    width?: number
    /** Read-only mode: disables the Save action. */
    disabled?: boolean
    /**
     * Full-bleed body: drops the default 16px padding and makes the body a full-height flex column
     * so a form can lay out its own edge-to-edge master/detail (e.g. the tool parameter editor).
     * The JSON view keeps its padding regardless. @default false
     */
    contentFlush?: boolean
    /** Body shown while the drawer opens, before `form` mounts. */
    loadingBody?: ReactNode
}

export function ConfigItemDrawer({
    open,
    mode,
    title,
    badge,
    subtitle,
    footerNote,
    error,
    saving = false,
    onCancel,
    onSave,
    saveDisabled = false,
    form,
    json,
    jsonOnly = false,
    headerExtra,
    width = 600,
    disabled = false,
    contentFlush = false,
    loadingBody = <FormDrawerSkeleton />,
}: ConfigItemDrawerProps) {
    const t = useT(configItemsCatalog)
    // Flush layout only helps the form; keep the JSON editor padded and independently scrollable.
    const flushForm = contentFlush && !jsonOnly

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) onCancel()
            }}
        >
            <SheetContent
                side="right"
                className="ag-drawer-elevated"
                style={{width, maxWidth: "calc(100% - 1rem)"}}
            >
                <SheetHeader>
                    {/* One row: the title, then the header action beside it. */}
                    <div className="flex items-center gap-2">
                        <SheetTitle className="min-w-0 flex-1">
                            {/* One line: title · subtitle. Stacked, the subtitle doubled the header
                                height for a few muted words, and the leading icon repeated the
                                row the drawer opened from. */}
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 truncate text-label font-medium">
                                    {title}
                                </span>
                                {badge ? (
                                    <Badge
                                        variant={badgeVariantFor(badge.color)}
                                        // `text-xs` displaces Badge's `text-badge-md` and brings no
                                        // line-height; antd Tag keeps its absolute tagLineHeight
                                        // (lineHeightSM x fontSizeSM = 22.4px).
                                        className="shrink-0 text-meta font-normal leading-[22.4px]"
                                    >
                                        {badge.text}
                                    </Badge>
                                ) : null}
                                {subtitle ? (
                                    <span className="min-w-0 truncate text-meta font-normal text-muted-foreground">
                                        · {subtitle}
                                    </span>
                                ) : null}
                            </div>
                        </SheetTitle>
                        {headerExtra != null ? <div>{headerExtra}</div> : null}
                    </div>
                </SheetHeader>
                <div
                    className={cn(
                        "min-h-0 flex-1 text-field-md text-foreground",
                        flushForm ? "flex h-full flex-col overflow-hidden" : "overflow-y-auto p-4",
                    )}
                >
                    {/* Lazy content: it mounts after the panel has painted and unmounts on close,
                        so the content component's logic only runs while the drawer is open. */}
                    <DeferredBody
                        fallback={
                            <div className={flushForm ? "h-full p-4" : "h-full"}>{loadingBody}</div>
                        }
                    >
                        {!jsonOnly ? (
                            form
                        ) : contentFlush ? (
                            // Body already provides the padding here (flushForm is false in JSON
                            // view); the wrapper only adds full-height independent scroll — no
                            // extra `p-4` (double-pad).
                            <div className="h-full overflow-auto">{json}</div>
                        ) : (
                            json
                        )}
                    </DeferredBody>
                </div>
                <SheetFooter>
                    {/* w-full, or the sheet's own end-justified footer keeps this row hugging the
                        actions and a left-hand note lands beside Cancel. */}
                    <div className="flex w-full min-w-0 items-center justify-between gap-3">
                        {error ? (
                            <span role="alert" className="min-w-0 text-meta text-destructive">
                                {error}
                            </span>
                        ) : footerNote ? (
                            <span className="min-w-0 truncate text-meta text-muted-foreground">
                                {footerNote}
                            </span>
                        ) : null}
                        {/* ml-auto keeps the actions right-aligned when there is no footer note. */}
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                            <Button variant="outline" onClick={onCancel}>
                                {t("entityUi.configItems.cancel")}
                            </Button>
                            <Button
                                variant="default"
                                onClick={onSave}
                                disabled={disabled || saveDisabled || saving}
                            >
                                {saving
                                    ? t("entityUi.configItems.saving")
                                    : mode === "create"
                                      ? t("entityUi.configItems.create")
                                      : t("entityUi.configItems.save")}
                            </Button>
                        </div>
                    </div>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
