import {createElement, useEffect, useMemo, useRef, type ReactElement, type ReactNode} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {getDefaultStore, useAtomValue} from "jotai"

import type {SidebarConfig} from "../types"

import {sidebarReorderActiveAtom} from "../reorder"

import {SIDEBAR_ENTITIES, sidebarEntitySourcesAtom} from "./registry"
import {getSidebarSourceStatusLabel} from "./status"
import type {SidebarEntity, SidebarEntityRef, SidebarEntitySource} from "./types"

const SHOW_ALL_LABEL = "Show all"

/**
 * Interleaves heading rows with the rows they cover. Headings follow the source's order, and one
 * with no rows left after the cap is dropped rather than left dangling over nothing.
 */
const groupedChildren = (
    entity: SidebarEntity,
    source: SidebarEntitySource,
    refs: SidebarEntityRef[],
    toRow: (ref: SidebarEntityRef, reorder?: RowReorder) => SidebarConfig,
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
        children.push({
            key: `${entity.parentKey}-group-${group.key}`,
            title: group.label,
            isGroupLabel: true,
            isDynamic: true,
            isCollapsed,
            dragItem: groupZone
                ? {
                      kind: "group",
                      id: source.reorder?.groupId?.(group.key) ?? group.key,
                      zone: groupZone,
                  }
                : undefined,
            onClick: entity.toggleGroupAtom
                ? () => getDefaultStore().set(entity.toggleGroupAtom!, group.key)
                : undefined,
        })
        if (isCollapsed) continue
        const rowZone = source.reorder?.rowZone?.(group.key)
        const ids = rowZone ? groupRefs.map((ref) => ref.id) : undefined
        children.push(
            ...groupRefs.map((ref, index) =>
                toRow(ref, rowZone && ids ? {zone: rowZone, ids, index} : undefined),
            ),
        )
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
    (ref: SidebarEntityRef, node: ReactNode, reorder?: RowReorder) => ReactElement
>

/**
 * Where a row sits in its arrangeable zone, for the non-drag path (the row menu's Move verbs).
 * Third argument, so a host that has not opted in keeps its two-arg wrapper.
 */
export interface RowReorder {
    zone: string
    /** The zone's row ids in render order — the Move verb's input. */
    ids: string[]
    index: number
}

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

    const toRow = (ref: SidebarEntityRef, reorder?: RowReorder): SidebarConfig => ({
        key: `${entity.parentKey}-${ref.id}`,
        dragItem: reorder ? {kind: "row", id: ref.id, zone: reorder.zone} : undefined,
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
            ? (node) => wrapRow(ref, node, reorder)
            : entity.wrapRow
              ? (node) => entity.wrapRow!(ref, node)
              : undefined,
    })

    // An ungrouped entity arranges its whole list in one zone.
    const flatIds = entity.dragZone ? visibleRefs.map((ref) => ref.id) : undefined
    const children: SidebarConfig[] =
        entity.getGroupKey && source?.groups?.length
            ? groupedChildren(entity, source, visibleRefs, toRow)
            : visibleRefs.map((ref, index) =>
                  toRow(
                      ref,
                      entity.dragZone && flatIds
                          ? {zone: entity.dragZone, ids: flatIds, index}
                          : undefined,
                  ),
              )

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
            result[key] = resolveChildren(
                entity,
                source,
                resolvedProjectURL,
                idleFallback,
                kindIcon,
                rowWrappers?.[key],
                rowIcons?.[key],
            )
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
