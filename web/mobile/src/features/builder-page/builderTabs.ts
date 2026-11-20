import type {BuilderTabKind, BuilderTabRef} from "./paneAgent"

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
}

export interface BuilderTabsState {
    tabs: BuilderTab[]
    active: string | null
    closed: string[]
    /** The builder tool calls this chat's tabs already followed, so a reload follows none again. */
    followed: string[]
}

/** At most this many tabs per chat; the closed-tab memory has the same cap. */
export const MAX_BUILDER_TABS = 50

/** How many followed tool call ids a chat keeps. */
const MAX_FOLLOWED = 200

export const EMPTY_BUILDER_TABS: BuilderTabsState = {
    tabs: [],
    active: null,
    closed: [],
    followed: [],
}

/** Records tool calls as followed. */
export const markFollowed = (state: BuilderTabsState, ids: string[]): BuilderTabsState => {
    const fresh = ids.filter((id) => !state.followed.includes(id))
    return fresh.length
        ? {...state, followed: [...state.followed, ...fresh].slice(-MAX_FOLLOWED)}
        : state
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
                  ? {...withName(held, tab.name), dot: held.dot || dot}
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

export const builderTabsKey = (sessionId: string) => `agenta:builder:tabs:${sessionId}`

const TAB_KINDS: readonly BuilderTabKind[] = ["agent", "automation", "tool", "app"]

const parseTab = (value: unknown): BuilderTab | null => {
    if (!value || typeof value !== "object") return null
    const tab = value as Record<string, unknown>
    if (!TAB_KINDS.includes(tab.kind as BuilderTabKind)) return null
    if (typeof tab.id !== "string" || !tab.id) return null
    return {
        kind: tab.kind as BuilderTabKind,
        id: tab.id,
        name: typeof tab.name === "string" ? tab.name : "",
        ...(tab.dot === true ? {dot: true} : {}),
    }
}

/** The stored tabs of a chat; empty when there are none or storage cannot be read. */
export const readBuilderTabs = (sessionId: string): BuilderTabsState => {
    try {
        const raw: unknown = JSON.parse(
            window.localStorage.getItem(builderTabsKey(sessionId)) ?? "null",
        )
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
        const strings = (list: unknown, cap: number) =>
            (Array.isArray(list) ? list : [])
                .filter((key): key is string => typeof key === "string")
                .slice(-cap)
        return {
            tabs,
            active,
            closed: strings(value.closed, MAX_BUILDER_TABS),
            followed: strings(value.followed, MAX_FOLLOWED),
        }
    } catch {
        return EMPTY_BUILDER_TABS
    }
}

export const writeBuilderTabs = (sessionId: string, state: BuilderTabsState) => {
    try {
        window.localStorage.setItem(builderTabsKey(sessionId), JSON.stringify(state))
    } catch {
        // Storage refused: the tabs last for this visit.
    }
}
