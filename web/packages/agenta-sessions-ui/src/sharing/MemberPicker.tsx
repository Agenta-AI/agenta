import {useId, useMemo, useRef, useState, type KeyboardEvent} from "react"

import type {ProjectMemberProfile} from "@agenta/entities/sharing"
import {Popover, PopoverAnchor, PopoverContent, SkeletonBlock, cn} from "@agenta/ui/ui"
import {MagnifyingGlassIcon, XIcon} from "@phosphor-icons/react"

import {memberPickerCopy} from "./copy"
import {PersonAvatar, personName, type SharingPerson} from "./people"

export interface MemberPickerProps {
    /** "multiple": chips for several people; "single": one person (the transfer picker). */
    mode?: "multiple" | "single"
    projectName: string
    /** Project members for the current search (the members route, never workspace members). */
    members: readonly ProjectMemberProfile[]
    search: string
    onSearch: (text: string) => void
    /** The picked people, shown as chips. */
    selected: readonly SharingPerson[]
    onPick: (member: ProjectMemberProfile) => void
    onRemove: (userId: string) => void
    /** Never listed (the owner). */
    excludeUserIds?: readonly string[]
    /** Listed with "Has access" and not pickable. */
    accessUserIds?: readonly string[]
    /** Chips shown in the error color (a 422 `invalid_grantee`). */
    invalidUserIds?: readonly string[]
    loading?: boolean
    error?: boolean
    disabled?: boolean
    className?: string
}

export const MemberPicker = ({
    mode = "multiple",
    projectName,
    members,
    search,
    onSearch,
    selected,
    onPick,
    onRemove,
    excludeUserIds = [],
    accessUserIds = [],
    invalidUserIds = [],
    loading = false,
    error = false,
    disabled = false,
    className,
}: MemberPickerProps) => {
    const listId = useId()
    const fieldRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(0)

    const selectedIds = useMemo(() => new Set(selected.map((p) => p.user_id)), [selected])
    const options = useMemo(
        () =>
            members.filter(
                (member) =>
                    !excludeUserIds.includes(member.user_id) && !selectedIds.has(member.user_id),
            ),
        [members, excludeUserIds, selectedIds],
    )
    const pickable = (member: ProjectMemberProfile) => !accessUserIds.includes(member.user_id)
    const showInput = mode === "multiple" || selected.length === 0

    const pick = (member: ProjectMemberProfile) => {
        if (!pickable(member)) return
        onPick(member)
        onSearch("")
        setActive(0)
        if (mode === "single") setOpen(false)
        inputRef.current?.focus()
    }

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault()
            setOpen(true)
            setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)))
        } else if (event.key === "ArrowUp") {
            event.preventDefault()
            setActive((index) => Math.max(index - 1, 0))
        } else if (event.key === "Enter") {
            const member = options[active]
            if (open && member) {
                event.preventDefault()
                pick(member)
            }
        } else if (event.key === "Backspace" && !search && selected.length > 0) {
            onRemove(selected[selected.length - 1].user_id)
        } else if (event.key === "Escape" && open) {
            event.stopPropagation()
            setOpen(false)
        }
    }

    const query = search.trim()

    return (
        <Popover open={open && !disabled} onOpenChange={setOpen} modal={false}>
            <PopoverAnchor asChild>
                <div
                    ref={fieldRef}
                    className={cn(
                        "box-border flex min-h-9 flex-1 flex-wrap items-center gap-1 rounded-control border border-solid border-border bg-background px-2 py-1",
                        invalidUserIds.some((id) => selectedIds.has(id)) && "border-error",
                        disabled && "opacity-50",
                        className,
                    )}
                    onClick={() => inputRef.current?.focus()}
                >
                    {showInput && selected.length === 0 ? (
                        <MagnifyingGlassIcon
                            size={14}
                            className="shrink-0 text-muted-foreground"
                            aria-hidden
                        />
                    ) : null}
                    {selected.map((person) => {
                        const invalid = invalidUserIds.includes(person.user_id)
                        return (
                            <span
                                key={person.user_id}
                                data-invalid={invalid || undefined}
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-0.5 pr-1.5 text-xs",
                                    invalid && "bg-error-bg text-error",
                                )}
                            >
                                <PersonAvatar person={person} />
                                {personName(person)}
                                <button
                                    type="button"
                                    aria-label={memberPickerCopy.remove(personName(person))}
                                    disabled={disabled}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        onRemove(person.user_id)
                                    }}
                                    className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-current"
                                >
                                    <XIcon size={12} aria-hidden />
                                </button>
                            </span>
                        )
                    })}
                    {showInput ? (
                        <input
                            ref={inputRef}
                            type="text"
                            role="combobox"
                            aria-expanded={open}
                            aria-controls={listId}
                            aria-autocomplete="list"
                            disabled={disabled}
                            value={search}
                            placeholder={selected.length === 0 ? memberPickerCopy.placeholder : ""}
                            onChange={(event) => {
                                onSearch(event.target.value)
                                setActive(0)
                                setOpen(true)
                            }}
                            // A focus alone (the dialog focuses this input when it opens) does
                            // not open the list: it would cover the dialog's footer (QA D9).
                            // A click, typing or the arrow key opens it.
                            onClick={() => setOpen(true)}
                            onKeyDown={onKeyDown}
                            className="min-w-[80px] flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none [font-family:inherit] placeholder:text-muted-foreground"
                        />
                    ) : null}
                </div>
            </PopoverAnchor>
            <PopoverContent
                align="start"
                className="flex w-[var(--radix-popover-trigger-width)] flex-col gap-0.5 p-1"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={(event) => {
                    if (fieldRef.current?.contains(event.target as Node)) event.preventDefault()
                }}
            >
                <span className="px-2.5 pb-1 pt-1.5 text-xs text-muted-foreground">
                    {memberPickerCopy.heading(projectName)}
                </span>
                <div id={listId} role="listbox" aria-label={memberPickerCopy.heading(projectName)}>
                    {loading ? (
                        <div className="flex flex-col gap-2 px-2.5 py-1.5" aria-busy>
                            <SkeletonBlock className="h-7 w-full" />
                            <SkeletonBlock className="h-7 w-full" />
                            <SkeletonBlock className="h-7 w-full" />
                        </div>
                    ) : error ? (
                        <span className="block px-2.5 py-1.5 text-sm text-error">
                            {memberPickerCopy.error}
                        </span>
                    ) : options.length === 0 && query ? (
                        <span className="block px-2.5 py-1.5 text-sm text-muted-foreground">
                            {memberPickerCopy.noMatch(query)}
                        </span>
                    ) : (
                        options.map((member, index) => {
                            const enabled = pickable(member)
                            return (
                                <div
                                    key={member.user_id}
                                    role="option"
                                    aria-selected={index === active}
                                    aria-disabled={!enabled || undefined}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => setActive(index)}
                                    onClick={() => pick(member)}
                                    className={cn(
                                        "flex items-center gap-2 rounded-control-sm px-2.5 py-1.5",
                                        enabled ? "cursor-pointer" : "cursor-default opacity-60",
                                        enabled && index === active && "bg-accent",
                                    )}
                                >
                                    <PersonAvatar person={member} />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-sm font-medium">
                                            {personName(member)}
                                        </span>
                                        {member.name ? (
                                            <span className="truncate text-xs text-muted-foreground">
                                                {member.email}
                                            </span>
                                        ) : null}
                                    </span>
                                    {enabled ? null : (
                                        <span className="text-xs text-muted-foreground">
                                            {memberPickerCopy.hasAccess}
                                        </span>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
                <div className="my-1 h-px bg-border" />
                <span className="px-2.5 pb-1.5 pt-1 text-xs text-muted-foreground">
                    {memberPickerCopy.footer}
                </span>
            </PopoverContent>
        </Popover>
    )
}
