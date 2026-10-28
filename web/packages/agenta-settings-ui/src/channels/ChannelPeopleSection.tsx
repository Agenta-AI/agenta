import {useCallback, useEffect, useRef, useState} from "react"

import {
    Alert,
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Spinner,
} from "@agenta/ui/ui"
import {UsersThree, X} from "@phosphor-icons/react"

import {errorMessage} from "./helpers"
import type {
    ChannelAudiencePerson,
    ChannelPeopleDirectory,
    ChannelPerson,
    ChannelPlatform,
    ChannelsActions,
} from "./types"

/**
 * "Who can message it": Everyone, or Specific people. The list lives on the agent binding, so
 * it limits only this agent. Slack people are found by name or email; Telegram people by their
 * numeric id, or from the people who wrote to the bot. "Specific people" with nobody on the
 * list is never saved (an empty list means everyone), and removing the last person returns
 * the setting to Everyone.
 */

export interface ChannelPeopleSectionProps {
    platform: ChannelPlatform
    connectionId: string
    actions: ChannelsActions
    /** The bot's handle, for "Wrote to @bot". */
    handle: string
    /** The Slack workspace name, when known. */
    workspaceName?: string | null
}

const ROW = "border-0 border-b border-solid border-border py-3"
const PERSON_ROW = "flex items-center gap-2.5 border-0 border-b border-solid border-border py-2.5"
const GROUP =
    "flex items-center justify-between pt-2 pb-1 text-xs font-medium text-muted-foreground"
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// How long the picker waits after the last key before it searches.
const SEARCH_DELAY_MS = 250
// How often the picker asks again while the workspace list loads, and how many times.
const LOADING_POLL_MS = 3000
const LOADING_POLLS = 20

const initials = (name: string | null, id: string) =>
    (name ?? id)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("")

const ago = (iso: string | null): string => {
    if (!iso) return ""
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (!Number.isFinite(minutes) || minutes < 1) return "just now"
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
}

export const ChannelPeopleSection = ({
    platform,
    connectionId,
    actions,
    handle,
    workspaceName,
}: ChannelPeopleSectionProps) => {
    const isSlack = platform === "slack"
    const workspace = workspaceName || "the workspace"

    const [people, setPeople] = useState<ChannelAudiencePerson[] | null>(null)
    // "Specific people" with nobody added yet is only local: an empty list means everyone.
    const [restrictDraft, setRestrictDraft] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [draft, setDraft] = useState("")
    const [draftError, setDraftError] = useState<string | null>(null)

    // --- the people the picker found -------------------------------------------- //
    const [found, setFound] = useState<ChannelPerson[] | null>(null)
    const [directory, setDirectory] = useState<ChannelPeopleDirectory | null>(null)
    const [searchError, setSearchError] = useState<string | null>(null)
    const [refreshing, setRefreshing] = useState(false)
    const searchSeq = useRef(0)
    const polls = useRef(0)

    const load = useCallback(async () => {
        setError(null)
        try {
            setPeople(await actions.readAudience(connectionId))
        } catch (e) {
            setPeople(null)
            setError(errorMessage(e, "Could not read who can message it."))
        }
    }, [actions, connectionId])

    useEffect(() => {
        void load()
    }, [load])

    const restricted = restrictDraft || (people?.length ?? 0) > 0

    // Slack people who left the workspace stay listed until removed. Every search also asks
    // for the people on the list, so the workspace list says who left.
    const listedKey = (people ?? []).map((person) => person.id).join(",")

    const search = useCallback(
        async (text: string) => {
            const seq = ++searchSeq.current
            setSearchError(null)
            try {
                const result = await actions.queryPeople(
                    connectionId,
                    text,
                    listedKey ? listedKey.split(",") : undefined,
                )
                if (seq !== searchSeq.current) return
                setFound(result.people)
                setDirectory(result.directory)
            } catch (e) {
                if (seq !== searchSeq.current) return
                setFound([])
                setSearchError(errorMessage(e, "Could not search people."))
            }
        },
        [actions, connectionId, listedKey],
    )

    // Search as the owner types (Slack), and once on open for "wrote to the bot".
    useEffect(() => {
        if (!restricted) return
        if (!isSlack) {
            void search("")
            return
        }
        const timer = setTimeout(() => void search(draft), SEARCH_DELAY_MS)
        return () => clearTimeout(timer)
    }, [restricted, isSlack, draft, search])

    // While the workspace list loads in the background, ask again until it is there.
    useEffect(() => {
        if (!restricted || directory?.state !== "loading") {
            polls.current = 0
            return
        }
        if (polls.current >= LOADING_POLLS) return
        const timer = setTimeout(() => {
            polls.current += 1
            void search(isSlack ? draft : "")
        }, LOADING_POLL_MS)
        return () => clearTimeout(timer)
    }, [restricted, directory, draft, isSlack, search])

    const write = async (next: ChannelAudiencePerson[]) => {
        setSaving(true)
        setError(null)
        try {
            await actions.writeAudience(connectionId, next)
            setPeople(next)
            // The last person removed: the setting is Everyone again.
            if (next.length === 0) setRestrictDraft(false)
            return true
        } catch (e) {
            setError(errorMessage(e, "Could not save who can message it."))
            return false
        } finally {
            setSaving(false)
        }
    }

    const add = async (added: ChannelAudiencePerson[]) => {
        if (!people) return false
        const have = new Set(people.map((person) => person.id))
        const fresh = added.filter((person) => !have.has(person.id))
        if (!fresh.length) return true
        return write([...people, ...fresh])
    }

    const addTelegramIds = async () => {
        const ids = draft
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        if (!ids.length) return
        // The check compares the numeric id: a @username would be saved and never match.
        if (ids.some((id) => !/^\d+$/.test(id))) {
            setDraftError("Enter the numeric Telegram ID. A username cannot be matched.")
            return
        }
        setDraftError(null)
        const byId = new Map((found ?? []).map((person) => [person.id, person]))
        if (await add(ids.map((id) => ({id, name: byId.get(id)?.name ?? null, email: null}))))
            setDraft("")
    }

    const pick = async (person: ChannelPerson) => {
        if (person.isBot) return
        if (await add([{id: person.id, name: person.name, email: person.email}])) setDraft("")
    }

    const refresh = async () => {
        setRefreshing(true)
        try {
            setDirectory(await actions.refreshPeople(connectionId))
            polls.current = 0
        } catch (e) {
            setSearchError(errorMessage(e, "Could not refresh the people list."))
        } finally {
            setRefreshing(false)
        }
    }

    const chosen = new Set((people ?? []).map((person) => person.id))
    const leftIds = (found ?? [])
        .filter((person) => person.isDeleted && chosen.has(person.id))
        .map((person) => person.id)
    const candidates = (found ?? []).filter((person) => !chosen.has(person.id))
    const wrote = candidates.filter((person) => person.source === "messaged")
    const inWorkspace = candidates.filter((person) => person.source === "directory")
    const byEmail = candidates.filter((person) => person.source === "email")
    const typedEmail = EMAIL.test(draft.trim())

    const whoLine = (() => {
        if (people === null) return error ? "Unavailable" : "Loading…"
        if (!restricted)
            return isSlack
                ? "Any Slack member can message the bot."
                : "Any Telegram account can message the bot."
        if (!people.length) return `Add at least one ${isSlack ? "person" : "account"} below.`
        const n = people.length
        const noun = isSlack ? (n === 1 ? "person" : "people") : n === 1 ? "account" : "accounts"
        return `Only ${n} ${noun}. Everyone else is ignored.`
    })()

    const personItem = (person: ChannelPerson) => (
        <button
            key={person.id}
            type="button"
            disabled={person.isBot || saving}
            onClick={() => void pick(person)}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-1.5 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="channels-people-result"
        >
            <span className="flex size-6 flex-none items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
                {initials(person.name, person.id)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-foreground">
                    {person.name ?? person.username ?? person.id}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                    {person.isBot
                        ? "Bot · cannot be added"
                        : [person.email, person.isGuest ? "Guest" : null]
                              .filter(Boolean)
                              .join(" · ") || person.id}
                </span>
            </span>
        </button>
    )

    const slackResults = (
        <div
            className="flex flex-col rounded-lg border border-solid border-border p-1.5"
            data-testid="channels-people-results"
        >
            {searchError ? <Alert type="error" showIcon message={searchError} /> : null}
            <div className={GROUP}>
                <span>Wrote to {handle}</span>
            </div>
            {found === null ? (
                <span className="flex items-center gap-2 px-1.5 py-1 text-xs text-muted-foreground">
                    <Spinner size="small" /> Looking…
                </span>
            ) : wrote.length ? (
                wrote.map(personItem)
            ) : (
                <span className="px-1.5 py-1 text-xs text-muted-foreground">No match.</span>
            )}
            {directory && directory.state !== "unavailable" ? (
                <>
                    <div className={GROUP}>
                        <span>In {workspace}</span>
                        {directory.state === "ready" || directory.state === "failed" ? (
                            <span>
                                {refreshing
                                    ? "Refreshing… · "
                                    : directory.state === "ready"
                                      ? `Updated ${ago(directory.updatedAt)} · `
                                      : ""}
                                <button
                                    type="button"
                                    className="cursor-pointer border-0 bg-transparent p-0 text-xs text-primary"
                                    disabled={refreshing}
                                    onClick={() => void refresh()}
                                    data-testid="channels-people-refresh"
                                >
                                    Refresh
                                </button>
                            </span>
                        ) : null}
                    </div>
                    {directory.state === "failed" ? (
                        <span
                            className="px-1.5 py-1 text-xs text-muted-foreground"
                            data-testid="channels-people-failed"
                        >
                            Could not load people from {workspace}. Reinstall the Slack app, or type
                            a full email.
                        </span>
                    ) : directory.state === "loading" ? (
                        <span className="flex items-center gap-2 px-1.5 py-1 text-xs text-muted-foreground">
                            <Spinner size="small" /> Loading people from Slack…
                        </span>
                    ) : !draft.trim() ? (
                        <span className="px-1.5 py-1 text-xs text-muted-foreground">
                            Type a name to search.
                        </span>
                    ) : inWorkspace.length ? (
                        inWorkspace.map(personItem)
                    ) : (
                        <span className="px-1.5 py-1 text-xs text-muted-foreground">No match.</span>
                    )}
                </>
            ) : null}
            {typedEmail && found !== null ? (
                <>
                    <div className={GROUP}>
                        <span>By email</span>
                    </div>
                    {byEmail.length ? (
                        byEmail.map(personItem)
                    ) : candidates.some(
                          (person) =>
                              (person.email ?? "").toLowerCase() === draft.trim().toLowerCase(),
                      ) ? null : (
                        <span className="px-1.5 py-1 text-xs text-muted-foreground">
                            No one in {workspace} uses this email.
                        </span>
                    )}
                </>
            ) : null}
        </div>
    )

    return (
        <>
            <div className={`flex items-center gap-4 ${ROW}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm text-foreground">Who can message it</span>
                    <span className="text-[13px] text-muted-foreground">{whoLine}</span>
                </span>
                {saving ? <Spinner size="small" /> : null}
                <Select
                    value={restricted ? "specific" : "everyone"}
                    disabled={people === null || saving}
                    onValueChange={async (value) => {
                        if (value === "specific") {
                            setRestrictDraft(true)
                            return
                        }
                        setRestrictDraft(false)
                        if (people?.length) await write([])
                    }}
                >
                    <SelectTrigger
                        size="sm"
                        className="w-[150px]"
                        data-testid="channels-allowed-mode"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="everyone">Everyone</SelectItem>
                        <SelectItem value="specific">Specific people</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {error ? (
                <div className="flex items-center gap-2 pt-3">
                    <Alert type="error" showIcon message={error} className="flex-1" />
                    {people === null ? (
                        <Button variant="outline" size="sm" onClick={() => void load()}>
                            Try again
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {restricted && people !== null ? (
                <>
                    <div className={`flex flex-col gap-1.5 ${ROW}`}>
                        {isSlack ? (
                            <>
                                <Input
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    placeholder="Name or email in Slack"
                                    className="min-w-0 text-[13px]"
                                    data-testid="channels-allowed-input"
                                />
                                <span className="text-xs text-muted-foreground">
                                    Search people in {workspace}, or type a full email.
                                </span>
                                {slackResults}
                            </>
                        ) : (
                            <>
                                <div className="flex gap-2">
                                    <Input
                                        value={draft}
                                        onChange={(e) => {
                                            setDraft(e.target.value)
                                            setDraftError(null)
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") void addTelegramIds()
                                        }}
                                        placeholder="Telegram user ID"
                                        inputMode="numeric"
                                        className="min-w-0 flex-1 font-mono text-xs"
                                        data-testid="channels-allowed-input"
                                    />
                                    <Button
                                        variant="outline"
                                        disabled={!draft.trim() || saving}
                                        onClick={() => void addTelegramIds()}
                                        data-testid="channels-allowed-save"
                                    >
                                        Add
                                    </Button>
                                </div>
                                {draftError ? (
                                    <span
                                        className="text-xs text-destructive"
                                        data-testid="channels-allowed-error"
                                    >
                                        {draftError}
                                    </span>
                                ) : (
                                    <span className="text-xs text-muted-foreground">
                                        Numeric IDs, from @userinfobot. Separate several with
                                        commas.
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    {!isSlack && wrote.length ? (
                        <div className="flex flex-col" data-testid="channels-people-wrote">
                            <span className="pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                                People who wrote to the bot
                            </span>
                            {wrote.map((person) => (
                                <div key={person.id} className={PERSON_ROW}>
                                    <span className="box-border flex size-6 flex-none items-center justify-center rounded-md border border-solid border-border bg-muted text-muted-foreground">
                                        <UsersThree size={12} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-[13px] text-foreground">
                                            {person.name ?? person.id}
                                            {person.username ? ` (@${person.username})` : ""}
                                        </span>
                                        <span className="truncate font-mono text-xs text-muted-foreground">
                                            {person.id}
                                        </span>
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="xs"
                                        disabled={saving}
                                        onClick={() => void pick(person)}
                                    >
                                        Add
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {people.length === 0 ? (
                        <div className="pt-3">
                            <Alert
                                type="warning"
                                showIcon
                                message={`Until you add someone, ${handle} answers everyone.`}
                            />
                        </div>
                    ) : null}
                    {people.map((person) => (
                        <div
                            key={person.id}
                            className={PERSON_ROW}
                            data-testid="channels-allowed-user"
                        >
                            <span className="box-border flex size-6 flex-none items-center justify-center rounded-md border border-solid border-border bg-muted text-[10px] font-semibold text-muted-foreground">
                                {isSlack ? (
                                    initials(person.name, person.id)
                                ) : (
                                    <UsersThree size={12} />
                                )}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                                {isSlack ? (
                                    <>
                                        <span className="truncate text-[13px] text-foreground">
                                            {person.name ?? person.id}
                                        </span>
                                        <span className="truncate text-xs text-muted-foreground">
                                            {leftIds.includes(person.id)
                                                ? "No longer in Slack"
                                                : (person.email ?? person.id)}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <span className="truncate font-mono text-[13px] text-foreground">
                                            {person.id}
                                        </span>
                                        {person.name ? (
                                            <span className="truncate text-xs text-muted-foreground">
                                                {person.name}
                                            </span>
                                        ) : null}
                                    </>
                                )}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                title="Remove"
                                aria-label={`Remove ${person.name ?? person.id}`}
                                disabled={saving}
                                onClick={() =>
                                    void write(people.filter((other) => other.id !== person.id))
                                }
                            >
                                <X />
                            </Button>
                        </div>
                    ))}
                </>
            ) : null}
        </>
    )
}
