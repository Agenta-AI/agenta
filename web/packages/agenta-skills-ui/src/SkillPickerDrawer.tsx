/**
 * Add-skills picker — the AddSubagentDrawer anatomy applied to skills: search, a
 * `SKILLS · N` header with Add all, catalog rows, and two additions that anatomy lacks:
 * a split `[Add | ▾]` per row (plain Add = follow latest; the caret offers "Add pinned to
 * vN") and a footer `+ New skill ▾` (write / upload / import — created in the registry).
 * Presentational: options in, callbacks out.
 */
import {useEffect, useMemo, useState} from "react"

import {CatalogListRow, SubSectionHeader} from "@agenta/entity-ui/drill-in"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    EmptyState,
    SearchInput,
} from "@agenta/ui/ui"
import {CaretDown, Check, Lightning} from "@phosphor-icons/react"

import {NewSkillMenuButton, type NewSkillMenuButtonProps} from "./NewSkillMenuButton"
import {SkillAvatar, VersionTag} from "./SkillCard"
import type {SkillListItem} from "./types"

export interface SkillAddChoice {
    skill: SkillListItem
    /** "latest" follows the head; "pinned" fixes the skill's current head version. */
    mode: "latest" | "pinned"
}

export interface SkillPickerDrawerProps {
    open: boolean
    onClose: () => void
    options: SkillListItem[]
    loading?: boolean
    /** One write per author action. May be async; rows disable until it settles. */
    onAdd: (choices: SkillAddChoice[]) => void | Promise<void>
    onRemove: (skills: SkillListItem[]) => void | Promise<void>
    /** The `+ New skill ▾` paths; created skills land in the registry AND on this agent. */
    createActions: Pick<NewSkillMenuButtonProps, "onWrite" | "onUpload" | "onImport">
    width?: number
}

function SkillRow({
    option,
    busy,
    onAdd,
    onRemove,
}: {
    option: SkillListItem
    busy?: boolean
    onAdd: (mode: "latest" | "pinned") => void
    onRemove: () => void
}) {
    return (
        <CatalogListRow
            leading={<SkillAvatar origin={option.origin} />}
            title={<span className="font-mono">{option.slug}</span>}
            titleSuffix={
                <span className="flex shrink-0 items-center gap-1.5">
                    {option.version ? <VersionTag version={option.version} /> : null}
                    {option.origin === "builtin" ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-[var(--ag-colorTextTertiary)]">
                            <Lightning size={10} weight="fill" />
                            Agenta
                        </span>
                    ) : null}
                    {option.added ? (
                        <span className="flex items-center gap-1 text-xs font-normal text-[var(--ag-colorSuccessText)]">
                            <Check size={11} weight="bold" />
                            {option.pinnedVersion ? `Pinned v${option.pinnedVersion}` : "Added"}
                        </span>
                    ) : null}
                </span>
            }
            action={
                option.added ? (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={onRemove}
                        aria-label={`Remove ${option.slug}`}
                    >
                        Remove
                    </Button>
                ) : (
                    // The split action: plain Add is one-click follow-latest; the caret is the
                    // progressive-disclosure home of version choice (never a visible option row).
                    <span className="flex items-center">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => onAdd("latest")}
                            aria-label={`Add ${option.slug} following latest`}
                            className="rounded-r-none"
                        >
                            Add
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busy}
                                    aria-label={`Add ${option.slug} with version options`}
                                    className="rounded-l-none border-l-0 px-1.5"
                                >
                                    <CaretDown size={12} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => onAdd("latest")}>
                                    Add — follow latest
                                </DropdownMenuItem>
                                {option.version ? (
                                    <DropdownMenuItem onSelect={() => onAdd("pinned")}>
                                        Add pinned to v{option.version}
                                    </DropdownMenuItem>
                                ) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </span>
                )
            }
        >
            <span className="line-clamp-2 text-xs text-[var(--ag-colorTextSecondary)]">
                {option.description || "No description."}
            </span>
        </CatalogListRow>
    )
}

export function SkillPickerDrawer({
    open,
    onClose,
    options,
    loading,
    onAdd,
    onRemove,
    createActions,
    width = 480,
}: SkillPickerDrawerProps) {
    const [search, setSearch] = useState("")
    const [busy, setBusy] = useState(false)
    const run = async (write: () => void | Promise<void>) => {
        if (busy) return
        setBusy(true)
        try {
            await write()
        } finally {
            setBusy(false)
        }
    }

    useEffect(() => {
        if (!open) setSearch("")
    }, [open])

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return options
        return options.filter(
            (o) =>
                o.slug.toLowerCase().includes(q) ||
                o.name.toLowerCase().includes(q) ||
                (o.description ?? "").toLowerCase().includes(q),
        )
    }, [options, search])

    // Add all acts on what the search shows, never on hidden rows.
    const addable = useMemo(() => visible.filter((o) => !o.added), [visible])

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={width}
            destroyOnClose
            title={
                <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Add skills</span>
                    <span className="text-xs font-normal text-[var(--ag-colorTextSecondary)]">
                        Reference registry skills from this agent.
                    </span>
                </div>
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                <div className="flex items-center justify-between">
                    <NewSkillMenuButton {...createActions} variant="outline" disabled={busy} />
                    <Button variant="default" onClick={onClose}>
                        Done
                    </Button>
                </div>
            }
        >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <SearchInput
                    placeholder="Search skills..."
                    aria-label="Search skills"
                    value={search}
                    onValueChange={setSearch}
                />

                {!loading && visible.length === 0 ? (
                    <EmptyState
                        title={search.trim() ? "No skills match your search" : "No skills yet"}
                        description={
                            search.trim()
                                ? "Try a different name."
                                : "Create one below — it lands in the registry and on this agent."
                        }
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        <SubSectionHeader
                            label="Skills"
                            count={visible.length}
                            action={
                                addable.length > 1 ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy}
                                        onClick={() =>
                                            void run(() =>
                                                onAdd(
                                                    addable.map((skill) => ({
                                                        skill,
                                                        mode: "latest" as const,
                                                    })),
                                                ),
                                            )
                                        }
                                    >
                                        Add all
                                    </Button>
                                ) : undefined
                            }
                        />
                        <div className="flex flex-col overflow-hidden rounded-md border border-solid border-[var(--ag-colorBorderSecondary)]">
                            {visible.map((option) => (
                                <SkillRow
                                    key={option.id}
                                    option={option}
                                    busy={busy}
                                    onAdd={(mode) => void run(() => onAdd([{skill: option, mode}]))}
                                    onRemove={() => void run(() => onRemove([option]))}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </EnhancedDrawer>
    )
}
