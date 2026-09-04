import {createElement, useEffect, useMemo, useRef, type ReactElement, type ReactNode} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {getDefaultStore, useAtomValue} from "jotai"

import {sidebarReorderActiveAtom} from "../reorder"
import type {SidebarConfig} from "../types"

import {SIDEBAR_ENTITIES, sidebarEntitySourcesAtom} from "./registry"
import {getSidebarSourceStatusLabel} from "./status"
import type {SidebarEntity, SidebarEntityRef, SidebarEntitySource} from "./types"

const SHOW_ALL_LABEL = "Show all"

/** What a cached row was built from — any change and the row is rebuilt. */
interface RowInputs {
    projectURL: string
    dragZone?: string
    wrapRow?: SidebarRowWrappers[string]
    rowIcon?: SidebarRowIcons[string]
}

/**
 * Last row built for a row key, reused while nothing about it changed.
 *
 * Keyed on the ROW KEY and a signature of the ref, not on the ref object: the source rebuilds
 * every ref on every recompute, so identity is never stable and a WeakMap on it would miss every
 * time. Without this the whole list remounts on each poll, which fights a user mid-scroll.
 */
interface EntityRowCache {
    rows: Map<string, {signature: string; row: SidebarConfig}>
    /** The chrome the cached rows closed over — closures, so they cannot go in a signature. */
    chrome: {wrapRow?: RowInputs["wrapRow"]; rowIcon?: RowInputs["rowIcon"]}
}

/** Per ENTITY, not per parent key: two entities can share a key, and their rows differ. */
const rowCaches = new WeakMap<SidebarEntity, EntityRowCache>()

/** Bounded so a long run of filter changes cannot grow one entity's cache without limit. */
const ROW_CACHE_MAX = 2_000

const sameRowInputs = (a: RowInputs, b: RowInputs): boolean =>
    a.projectURL === b.projectURL &&
    a.dragZone === b.dragZone &&
    a.wrapRow === b.wrapRow &&
    a.rowIcon === b.rowIcon

const cachedRow = (
    entity: SidebarEntity,
    ref: SidebarEntityRef,
    inputs: RowInputs,
    build: (ref: SidebarEntityRef, dragZone?: string) => SidebarConfig,
): SidebarConfig => {
    let cache = rowCaches.get(entity)
    if (
        !cache ||
        cache.chrome.wrapRow !== inputs.wrapRow ||
        cache.chrome.rowIcon !== inputs.rowIcon
    ) {
        cache = {rows: new Map(), chrome: {wrapRow: inputs.wrapRow, rowIcon: inputs.rowIcon}}
        rowCaches.set(entity, cache)
    }

    const key = `${entity.parentKey}-${ref.id}`
    const signature = JSON.stringify([ref, inputs.projectURL, inputs.dragZone])
    const cached = cache.rows.get(key)
    if (cached && cached.signature === signature) return cached.row

    const row = build(ref, inputs.dragZone)
    if (cache.rows.size >= ROW_CACHE_MAX) cache.rows.clear()
    cache.rows.set(key, {signature, row})
    return row
}

/**
 * Interleaves heading rows with the rows they cover. Headings follow the source's order, and one
 * with no rows left after the cap is dropped rather than left dangling over nothing.
 */
const groupedChildren = (
    entity: SidebarEntity,
    source: SidebarEntitySource,
    refs: SidebarEntityRef[],
    toRow: (ref: SidebarEntityRef, dragZone?: string) => SidebarConfig,
): SidebarConfig[] => {
    const rowsByGroup = new Map<string, SidebarEntityRef[]>()
    for (const ref of refs) {
        const key = entity.getGroupKey!(ref)
        const bucket = rowsByGroup.get(key)
        if (bucket) bucket.push(ref)
        else rowsByGroup.set(key, [ref])
    }

    const collapsed = new Set(source.collapsedKeys ?? [])
    const children: SidebarConfig[] = []
    for (const group of source.groups ?? []) {
        const groupRefs = rowsByGroup.get(group.key)
        if (!groupRefs?.length) continue
        const isCollapsed = collapsed.has(group.key)
        const groupZone = source.reorder?.groupZone
        // A heading opts out by resolving to no id — Pinned is a heading like any other, but it
        // is not an agent and must never be written into the agent order.
        const groupId = source.reorder?.groupId ? source.reorder.groupId(group.key) : group.key
        children.push({
            key: `${entity.parentKey}-group-${group.key}`,
            title: group.label,
            isGroupLabel: true,
            isDynamic: true,
            isCollapsed,
            dragItem:
                groupZone && groupId ? {kind: "group", id: groupId, zone: groupZone} : undefined,
            onClick: entity.toggleGroupAtom
                ? () => getDefaultStore().set(entity.toggleGroupAtom!, group.key)
                : undefined,
        })
        if (isCollapsed) continue
        const rowZone = source.reorder?.rowZone?.(group.key)
        children.push(...groupRefs.map((ref) => toRow(ref, rowZone)))
    }
    return children
}

/** App-supplied fallback: entity kind → icon, for entities without an explicit one. */
export type SidebarKindIcon = (kind: SidebarEntity["kind"]) => ReactNode

/**
 * Per-row chrome the HOST supplies, keyed by entity parent key.
 *
 * The registry lives in this package and cannot reach app state; a session's row menu needs the
 * playground's local tab cache. Same seam as `localSessionRefsAtom`: the package composes what
 * it is given.
 */
/** Per-row icon renderers, injected by the app: this package stays headless and only calls them. */
export type SidebarRowIcons = Record<string, (ref: SidebarEntityRef) => ReactElement>

export type SidebarRowWrappers = Record<
    string,
    (ref: SidebarEntityRef, node: ReactNode) => ReactElement
>

/**
 * Maps one entity's gated source to menu children. Always returns ≥1 child — an
 * empty submenu would strip the parent's expand caret, leaving no way to open the
 * group (and so no way to trigger the gated fetch). Placeholders are disabled.
 */
export const resolveChildren = (
    entity: SidebarEntity,
    source: SidebarEntitySource | undefined,
    projectURL: string,
    idleFallback?: SidebarConfig[],
    kindIcon?: SidebarKindIcon,
    wrapRow?: SidebarRowWrappers[string],
    rowIcon?: SidebarRowIcons[string],
): SidebarConfig[] => {
    const icon = () => entity.icon ?? kindIcon?.(entity.kind)
    const status = source?.status ?? "idle"

    if (status === "idle") {
        if (idleFallback?.length) return idleFallback

        return [
            {
                key: `${entity.parentKey}-idle`,
                title: getSidebarSourceStatusLabel("idle"),
                icon: icon(),
                disabled: true,
                isDynamic: true,
                isPlaceholder: true,
            },
        ]
    }

    if (status === "loading") {
        return [
            {
                key: `${entity.parentKey}-loading`,
                title: getSidebarSourceStatusLabel("loading"),
                icon: icon(),
                disabled: true,
                isDynamic: true,
                isLoading: true,
            },
        ]
    }

    if (status === "error") {
        return [
            {
                key: `${entity.parentKey}-error`,
                title: getSidebarSourceStatusLabel("error"),
                icon: icon(),
                disabled: true,
                isDynamic: true,
                isPlaceholder: true,
            },
        ]
    }

    const refs = source?.refs ?? []
    if (!refs.length) {
        return [
            {
                key: `${entity.parentKey}-empty`,
                title: getSidebarSourceStatusLabel(
                    "ready",
                    source?.emptyLabel ?? entity.emptyLabel,
                ),
                icon: icon(),
                disabled: true,
                isDynamic: true,
                isPlaceholder: true,
            },
        ]
    }

    // Cap FIRST, group second: `maxItems` is every entity's contract, and a grouped entity must
    // not quietly render more rows than an ungrouped one.
    const visibleRefs = refs.slice(0, entity.maxItems)

    const buildRow = (ref: SidebarEntityRef, dragZone?: string): SidebarConfig => ({
        key: `${entity.parentKey}-${ref.id}`,
        dragItem: dragZone ? {kind: "row", id: ref.id, zone: dragZone} : undefined,
        title: entity.getLabel(ref),
        // Context the label cannot carry (#5945) — e.g. which agent a session belongs to.
        tooltip: entity.getTooltip?.(ref),
        link: entity.childLink(ref, projectURL),
        // A row can own more routes than it navigates to.
        matchLinks: entity.childMatchLinks?.(ref, projectURL),
        icon: rowIcon?.(ref) ?? entity.getIcon?.(ref) ?? icon(),
        rowClassName: entity.getRowClassName?.(ref),
        isDynamic: true,
        onClick: entity.getOnClick?.(ref),
        wrapRow: wrapRow
            ? (node) => wrapRow(ref, node)
            : entity.wrapRow
              ? (node) => entity.wrapRow!(ref, node)
              : undefined,
    })

    // A ref whose identity survived the poll keeps its row object, so `React.memo` on the row
    // components holds instead of re-rendering the whole list every 15s.
    const toRow = (ref: SidebarEntityRef, dragZone?: string): SidebarConfig =>
        cachedRow(entity, ref, {projectURL, dragZone, wrapRow, rowIcon}, buildRow)

    const children: SidebarConfig[] =
        entity.getGroupKey && source?.groups?.length
            ? groupedChildren(entity, source, visibleRefs, toRow)
            : // An ungrouped entity arranges its whole list in one zone.
              visibleRefs.map((ref) => toRow(ref, entity.dragZone))

    if (entity.showAllLink && refs.length > visibleRefs.length) {
        children.push({
            key: `${entity.parentKey}-show-all`,
            title: SHOW_ALL_LABEL,
            link: entity.showAllLink(projectURL),
            icon: createElement(ArrowRight, {size: 14}),
            isDynamic: true,
        })
    }

    return children
}

/**
 * Resolves every registered entity to its menu children in a single subscription.
 * Returns a `parentKey → children` map consumed by {@link injectDynamicChildren}.
 */
export const useSidebarDynamicChildren = ({
    projectURL,
    kindIcon,
    rowWrappers,
    rowIcons,
}: {
    /** The active project's URL prefix — route shape is shared, the base is the app's. */
    projectURL: string | undefined
    kindIcon?: SidebarKindIcon
    rowWrappers?: SidebarRowWrappers
    rowIcons?: SidebarRowIcons
}): Record<string, SidebarConfig[]> => {
    const sources = useAtomValue(sidebarEntitySourcesAtom)
    const reordering = useAtomValue(sidebarReorderActiveAtom)
    const cachedChildrenRef = useRef<
        Record<string, {projectURL: string; children: SidebarConfig[]}>
    >({})
    // Per-entity memo. `sidebarEntitySourcesAtom` is one object for all four entities, so any one
    // source changing used to rebuild every entity's children.
    const resolvedRef = useRef<
        Record<
            string,
            {
                source: SidebarEntitySource | undefined
                inputs: RowInputs
                idleFallback: SidebarConfig[] | undefined
                children: SidebarConfig[]
            }
        >
    >({})

    // Pure: only reads the cache (populated after commit by the effect below), so
    // Strict Mode's double render can't corrupt it.
    const childrenByKey = useMemo(() => {
        const resolvedProjectURL = projectURL ?? ""
        const cachedChildren = cachedChildrenRef.current
        const sourcesByKey = sources ?? {}
        const result: Record<string, SidebarConfig[]> = {}
        for (const [key, entity] of Object.entries(SIDEBAR_ENTITIES)) {
            const source = sourcesByKey[key]
            const cached = cachedChildren[key]
            // Hold the rows still while a drag is in flight: a poll landing mid-gesture would
            // otherwise add, remove or reorder a row under the pointer and invalidate the drag
            // engine's cached rects.
            if (reordering && cached?.projectURL === resolvedProjectURL) {
                result[key] = cached.children
                continue
            }
            const idleFallback =
                cached?.projectURL === resolvedProjectURL ? cached.children : undefined
            const inputs: RowInputs = {
                projectURL: resolvedProjectURL,
                dragZone: entity.dragZone,
                wrapRow: rowWrappers?.[key],
                rowIcon: rowIcons?.[key],
            }
            const previous = resolvedRef.current[key]
            if (
                previous &&
                previous.source === source &&
                previous.idleFallback === idleFallback &&
                sameRowInputs(previous.inputs, inputs)
            ) {
                result[key] = previous.children
                continue
            }
            const children = resolveChildren(
                entity,
                source,
                resolvedProjectURL,
                idleFallback,
                kindIcon,
                rowWrappers?.[key],
                rowIcons?.[key],
            )
            resolvedRef.current[key] = {source, inputs, idleFallback, children}
            result[key] = children
        }
        return result
    }, [sources, projectURL, kindIcon, rowWrappers, rowIcons, reordering])

    // Keep the last non-idle children per group so a group going idle (its query
    // unsubscribing) still renders its previous items instead of the idle placeholder.
    useEffect(() => {
        if (reordering) return
        const resolvedProjectURL = projectURL ?? ""
        const sourcesByKey = sources ?? {}
        for (const key of Object.keys(SIDEBAR_ENTITIES)) {
            const status = sourcesByKey[key]?.status
            if (status && status !== "idle") {
                cachedChildrenRef.current[key] = {
                    projectURL: resolvedProjectURL,
                    children: childrenByKey[key],
                }
            }
        }
    }, [sources, projectURL, childrenByKey, reordering])

    return childrenByKey
}

/**
 * Walks the static sidebar config and attaches dynamic children to any item whose
 * key is a registered entity (e.g. "Prompts", "Test sets"). Existing static
 * submenus (Evaluation group, Help & Docs) are preserved and recursed into, so
 * nested entities like Test sets are reached.
 */
export const injectDynamicChildren = (
    items: SidebarConfig[],
    childrenByKey: Record<string, SidebarConfig[]>,
): SidebarConfig[] =>
    items.map((item) => {
        const dynamicChildren = childrenByKey[item.key]
        if (dynamicChildren) return {...item, submenu: dynamicChildren, isDynamic: true}
        if (item.submenu) {
            return {...item, submenu: injectDynamicChildren(item.submenu, childrenByKey)}
        }
        return item
    })
