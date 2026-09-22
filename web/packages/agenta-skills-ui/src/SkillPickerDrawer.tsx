// Add-skills picker: the home page's agent rows, each a toggle that follows the latest version.
import {useEffect, useMemo, useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {cn} from "@agenta/ui/styles"
import {Button, EmptyState, SearchInput} from "@agenta/ui/ui"
import {Check, Lightning, Plus} from "@phosphor-icons/react"

import {SkillAvatar} from "./SkillCard"
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
    /**
     * Opens the create drawer; a created skill lands in the registry AND on this agent. The
     * picker closes first — one drawer at a time.
     */
    onNewSkill: () => void
    width?: number
}

/** The home page's agent row, restated for a skill: a tile, the name over its description. */
const ROW =
    "box-border flex w-full cursor-pointer appearance-none items-center gap-3.5 rounded-[10px] border-0 bg-transparent px-3.5 py-2 text-left font-[inherit] outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:opacity-60"

/**
 * One row is one toggle: a click adds the skill (following the latest version), a click on an
 * added row takes it back off. The tint and the check say which rows are on the agent.
 */
function SkillRow({
    option,
    busy,
    onAdd,
    onRemove,
}: {
    option: SkillListItem
    busy?: boolean
    onAdd: () => void
    onRemove: () => void
}) {
    return (
        <button
            type="button"
            disabled={busy}
            onClick={option.added ? onRemove : onAdd}
            aria-pressed={Boolean(option.added)}
            aria-label={`${option.added ? "Remove" : "Add"} ${option.slug}`}
            className={cn(ROW, option.added && "bg-accent")}
        >
            <SkillAvatar
                origin={option.origin}
                slug={option.slug}
                className="size-[34px] rounded-[10px] text-[13px]"
            />
            {/* The description line renders even when empty, so rows keep one height. */}
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate font-mono text-sm leading-[1.45] text-foreground">
                    {option.name || option.slug}
                </span>
                <span className="truncate text-[13px] leading-[1.45] text-muted-foreground">
                    {option.description?.trim() || "No description"}
                </span>
            </span>
            {option.origin === "builtin" ? (
                <span className="flex shrink-0 items-center gap-0.5 pl-2 text-[10px] text-muted-foreground">
                    <Lightning size={10} weight="fill" />
                    Agenta
                </span>
            ) : option.source ? (
                <span className="max-w-32 shrink-0 truncate rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                    {option.source.label}
                </span>
            ) : null}
            {option.added ? (
                <Check aria-hidden size={14} className="ml-2 shrink-0 text-foreground" />
            ) : (
                <span className="ml-2 shrink-0 text-[13px] text-muted-foreground">Add</span>
            )}
        </button>
    )
}

export function SkillPickerDrawer({
    open,
    onClose,
    options,
    loading,
    onAdd,
    onRemove,
    onNewSkill,
    width = 480,
}: SkillPickerDrawerProps) {
    const [search, setSearch] = useState("")
    const [busy, setBusy] = useState(false)
    // Done is inert until a tap has changed the agent: with nothing done, it is only Close.
    const [changed, setChanged] = useState(false)
    const run = async (write: () => void | Promise<void>) => {
        if (busy) return
        setBusy(true)
        try {
            await write()
            setChanged(true)
        } finally {
            setBusy(false)
        }
    }

    useEffect(() => {
        if (!open) {
            setSearch("")
            setChanged(false)
        }
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
                <Button variant="default" onClick={onClose} disabled={!changed || busy}>
                    Done
                </Button>
            }
        >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                {/* Search and New skill share a row: finding one and making one are the two
                    ways in, side by side. */}
                <div className="flex items-center gap-2">
                    <SearchInput
                        placeholder="Search skills..."
                        aria-label="Search skills"
                        value={search}
                        onValueChange={setSearch}
                    />
                    <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                            onClose()
                            onNewSkill()
                        }}
                        className="shrink-0 gap-1.5"
                    >
                        <Plus size={14} />
                        New skill
                    </Button>
                </div>

                {!loading && visible.length === 0 ? (
                    // The @agenta/ui/ui EmptyState has no title prop; both lines go in description.
                    <EmptyState
                        image="simple"
                        description={
                            <span className="flex flex-col gap-1 text-xs">
                                <span className="font-medium text-[var(--ag-colorText)]">
                                    {search.trim()
                                        ? "No skills match your search"
                                        : "No skills yet"}
                                </span>
                                <span>
                                    {search.trim()
                                        ? "Try a different name."
                                        : "Create one below — it lands in the registry and on this agent."}
                                </span>
                            </span>
                        }
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="-mx-2 flex flex-col gap-0.5">
                            {visible.map((option) => (
                                <SkillRow
                                    key={option.id}
                                    option={option}
                                    busy={busy}
                                    onAdd={() =>
                                        void run(() => onAdd([{skill: option, mode: "latest"}]))
                                    }
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
