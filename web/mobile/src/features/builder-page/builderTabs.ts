import type {AgentRef, AgentResult} from "./paneAgent"

/** A builder tab key in the address: `?tab=<kind>:<id>`. */
export type BuilderTabKind = "agent" | "automation" | "tool" | "app"
export interface BuilderTabRef {
    kind: BuilderTabKind
    id: string
}

const TAB_KINDS: readonly BuilderTabKind[] = ["agent", "automation", "tool", "app"]

/** `agent:<id>` and the other kinds, or null for anything else. */
export const parseTabParam = (value: unknown): BuilderTabRef | null => {
    if (typeof value !== "string") return null
    const at = value.indexOf(":")
    if (at <= 0) return null
    const kind = value.slice(0, at) as BuilderTabKind
    const id = value.slice(at + 1)
    return TAB_KINDS.includes(kind) && id ? {kind, id} : null
}

/**
 * The builder tabs of one chat (design D15, D16): the open tabs in the order they opened, the
 * active one, and the tabs the person closed in this chat (a closed tab does not reopen by
 * itself). Kept in this browser under `agenta:builder:tabs:${sessionId}`; a browser that refuses
 * storage keeps the tabs of this visit only.
 */
export interface BuilderTab extends BuilderTabRef {
    /** The name the tab shows; empty until a source names it. */
    name: string
    /** The builder changed it while it was not the active tab. */
    dot?: boolean
    /** Agent panel sections the builder changed, marked until the person opens them (41.2). */
    changed?: string[]
}

export interface BuilderTabsState {
    tabs: BuilderTab[]
    active: string | null
    closed: string[]
    /**
     * The builder tool calls this chat's tabs already followed, so a reload follows none again.
     * Not capped: a forgotten id would be followed again.
     */
    followedToolCallIds: string[]
}

/** At most this many tabs per chat; the closed-tab memory has the same cap. */
export const MAX_BUILDER_TABS = 50

export const EMPTY_BUILDER_TABS: BuilderTabsState = {
    tabs: [],
    active: null,
    closed: [],
    followedToolCallIds: [],
}

/** Records tool calls as followed. */
const markFollowed = (state: BuilderTabsState, ids: string[]): BuilderTabsState => {
    const fresh = ids.filter((id) => !state.followedToolCallIds.includes(id))
    return fresh.length
        ? {...state, followedToolCallIds: [...state.followedToolCallIds, ...fresh]}
        : state
}

/** True for a chat that has never had a tab and followed nothing. */
export const isUntouched = (state: BuilderTabsState) =>
    !state.tabs.length && !state.closed.length && !state.followedToolCallIds.length

export const agentTab = (agent: AgentRef, changed: string[] = []): BuilderTab => ({
    kind: "agent",
    id: agent.id,
    name: agent.name,
    ...(changed.length ? {changed} : {}),
})

const mergeChanged = (held: string[] | undefined, more: string[] | undefined) => {
    const all = [...new Set([...(held ?? []), ...(more ?? [])])]
    return all.length ? {changed: all} : {}
}

export const builderTabKey = (ref: BuilderTabRef) => `${ref.kind}:${ref.id}`

/** Drops the oldest tabs that are not active until the cap holds. */
const capTabs = (tabs: BuilderTab[], active: string | null): BuilderTab[] => {
    const kept = [...tabs]
    while (kept.length > MAX_BUILDER_TABS) {
        const oldest = kept.findIndex((tab) => builderTabKey(tab) !== active)
        kept.splice(oldest, 1)
    }
    return kept
}

const withName = (tab: BuilderTab, name: string): BuilderTab =>
    name && name !== tab.name ? {...tab, name} : tab

/**
 * The person opens a tab (a chip, "+", a link): it opens or comes forward and is active. It
 * leaves the closed-tab memory, so the builder may mark it again.
 */
export const openBuilderTab = (state: BuilderTabsState, tab: BuilderTab): BuilderTabsState => {
    const key = builderTabKey(tab)
    const found = state.tabs.some((held) => builderTabKey(held) === key)
    const tabs = found
        ? state.tabs.map((held) =>
              builderTabKey(held) === key ? {...withName(held, tab.name), dot: false} : held,
          )
        : [...state.tabs, {...tab, dot: false}]
    return {
        ...state,
        tabs: capTabs(tabs, key),
        active: key,
        closed: state.closed.filter((closed) => closed !== key),
    }
}

/**
 * The builder saved or created something: its tab opens with a dot, or an open tab gets the dot;
 * the active tab does not change. The first tab of a chat opens active with no dot. A tab the
 * person closed in this chat does not reopen.
 */
export const followBuilderResult = (state: BuilderTabsState, tab: BuilderTab): BuilderTabsState => {
    const key = builderTabKey(tab)
    if (state.closed.includes(key)) return state
    if (state.active === null && state.tabs.length === 0)
        return {...state, tabs: [{...tab, dot: false}], active: key}
    const found = state.tabs.some((held) => builderTabKey(held) === key)
    const dot = key !== state.active
    const tabs = found
        ? state.tabs.map((held) =>
              builderTabKey(held) === key
                  ? {
                        ...withName(held, tab.name),
                        dot: held.dot || dot,
                        ...mergeChanged(held.changed, tab.changed),
                    }
                  : held,
          )
        : [...state.tabs, {...tab, dot}]
    return {...state, tabs: capTabs(tabs, state.active)}
}

/** The person picks a tab: it is active and its dot goes away. */
export const activateBuilderTab = (state: BuilderTabsState, key: string): BuilderTabsState => {
    if (!state.tabs.some((tab) => builderTabKey(tab) === key)) return state
    return {
        ...state,
        active: key,
        tabs: state.tabs.map((tab) => (builderTabKey(tab) === key ? {...tab, dot: false} : tab)),
    }
}

/**
 * The person closes a tab. The closed tab is remembered for this chat. Closing the active tab
 * makes the nearest tab active: the next one, else the one before.
 */
export const closeBuilderTab = (state: BuilderTabsState, key: string): BuilderTabsState => {
    const index = state.tabs.findIndex((tab) => builderTabKey(tab) === key)
    if (index < 0) return state
    const tabs = state.tabs.filter((_, at) => at !== index)
    const nearest = tabs[index] ?? tabs[index - 1] ?? null
    const active = state.active === key ? (nearest ? builderTabKey(nearest) : null) : state.active
    const closed = [...state.closed.filter((held) => held !== key), key].slice(-MAX_BUILDER_TABS)
    return {
        ...state,
        tabs: active
            ? tabs.map((tab) => (builderTabKey(tab) === active ? {...tab, dot: false} : tab))
            : tabs,
        active,
        closed,
    }
}

/** The person opened a marked section of a tab: its mark goes away. */
export const clearChangedSection = (
    state: BuilderTabsState,
    key: string,
    section: string,
): BuilderTabsState => {
    const tab = state.tabs.find((held) => builderTabKey(held) === key)
    if (!tab?.changed?.includes(section)) return state
    return {
        ...state,
        tabs: state.tabs.map((held) => {
            if (held !== tab) return held
            const {changed, ...rest} = held
            const left = (changed ?? []).filter((name) => name !== section)
            return left.length ? {...rest, changed: left} : rest
        }),
    }
}

/** The tab the address names comes forward; a link to a tab this chat does not hold opens it. */
export const applyAddressTab = (
    state: BuilderTabsState,
    ref: BuilderTabRef | null,
): BuilderTabsState => {
    if (!ref) return state
    const key = builderTabKey(ref)
    if (state.active === key) return state
    if (state.tabs.some((tab) => builderTabKey(tab) === key)) return activateBuilderTab(state, key)
    return openBuilderTab(state, {...ref, name: ""})
}

/**
 * The chat's builder results as they stand (on load and after each change). A chat with no tab
 * yet opens one for the agent of its latest result, else `fallbackAgent` (the page context, else
 * the browser link), and counts every result so far as followed. After that, each result not
 * yet followed is recorded, and a saved one opens its agent's tab with a dot
 * (`followBuilderResult`); a result with no change, a refusal or a denied call changes no tab.
 */
export const followBuilderResults = (
    state: BuilderTabsState,
    results: readonly AgentResult[],
    fallbackAgent: AgentRef | null,
): BuilderTabsState => {
    if (isUntouched(state)) {
        const latest = results.at(-1)?.agent ?? fallbackAgent
        const fresh = latest ? followBuilderResult(state, agentTab(latest)) : state
        return markFollowed(
            fresh,
            results.map((result) => result.toolCallId),
        )
    }
    let next = state
    for (const result of results) {
        if (next.followedToolCallIds.includes(result.toolCallId)) continue
        next = markFollowed(next, [result.toolCallId])
        if (result.saved)
            next = followBuilderResult(next, agentTab(result.agent, result.sections))
    }
    return next
}

/** The address value of a tab: `?tab=<kind>:<id>`, or none. */
export const builderTabHref = (path: string, key: string | null) =>
    key ? `${path}?tab=${encodeURIComponent(key)}` : path

export const builderTabsStorageKey = (sessionId: string) => `agenta:builder:tabs:${sessionId}`

const parseTab = (value: unknown): BuilderTab | null => {
    if (!value || typeof value !== "object") return null
    const tab = value as Record<string, unknown>
    if (!TAB_KINDS.includes(tab.kind as BuilderTabKind)) return null
    if (typeof tab.id !== "string" || !tab.id) return null
    return {
        kind: tab.kind as BuilderTabKind,
        id: tab.id,
        name: typeof tab.name === "string" ? tab.name : "",
        dot: tab.dot === true,
        ...(Array.isArray(tab.changed) && tab.changed.length
            ? {changed: tab.changed.filter((name): name is string => typeof name === "string")}
            : {}),
    }
}

/** The tabs of each chat in this visit, for a browser that refuses storage. */
const visitTabs = new Map<string, BuilderTabsState>()

/** The stored tabs of a chat; this visit's tabs when storage refuses reads; else none. */
export const readBuilderTabs = (sessionId: string): BuilderTabsState => {
    let stored: string | null
    try {
        stored = window.localStorage.getItem(builderTabsStorageKey(sessionId))
    } catch {
        return visitTabs.get(sessionId) ?? EMPTY_BUILDER_TABS
    }
    try {
        const raw: unknown = JSON.parse(stored ?? "null")
        if (!raw || typeof raw !== "object") return EMPTY_BUILDER_TABS
        const value = raw as Record<string, unknown>
        const tabs = (Array.isArray(value.tabs) ? value.tabs : [])
            .map(parseTab)
            .filter((tab): tab is BuilderTab => tab !== null)
            .slice(-MAX_BUILDER_TABS)
        const keys = tabs.map(builderTabKey)
        const active =
            typeof value.active === "string" && keys.includes(value.active)
                ? value.active
                : (keys[0] ?? null)
        const strings = (list: unknown) =>
            (Array.isArray(list) ? list : []).filter(
                (key): key is string => typeof key === "string",
            )
        return {
            tabs,
            active,
            closed: strings(value.closed).slice(-MAX_BUILDER_TABS),
            followedToolCallIds: strings(value.followedToolCallIds),
        }
    } catch {
        return EMPTY_BUILDER_TABS
    }
}

export const writeBuilderTabs = (sessionId: string, state: BuilderTabsState) => {
    visitTabs.set(sessionId, state)
    try {
        window.localStorage.setItem(builderTabsStorageKey(sessionId), JSON.stringify(state))
    } catch {
        // Storage refused: the tabs last for this visit (visitTabs).
    }
}
