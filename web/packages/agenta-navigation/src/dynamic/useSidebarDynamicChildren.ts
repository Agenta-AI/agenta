import {createElement, useEffect, useMemo, useRef, type ReactNode} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import type {SidebarConfig} from "../types"

import {SIDEBAR_ENTITIES, sidebarEntitySourcesAtom} from "./registry"
import {getSidebarSourceStatusLabel} from "./status"
import type {SidebarEntity, SidebarEntitySource} from "./types"

const SHOW_ALL_LABEL = "Show all"

/** App-supplied fallback: entity kind → icon, for entities without an explicit one. */
export type SidebarKindIcon = (kind: SidebarEntity["kind"]) => ReactNode

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
                title: getSidebarSourceStatusLabel("ready", entity.emptyLabel),
                icon: icon(),
                disabled: true,
                isDynamic: true,
                isPlaceholder: true,
            },
        ]
    }

    const visibleRefs = refs.slice(0, entity.maxItems)
    // A heading only earns its row when it separates something: with one group (everything pinned,
    // or nothing pinned) it labels the whole list and says nothing the list does not.
    const distinctGroups = new Set(visibleRefs.map((ref) => entity.getGroup?.(ref) ?? null))
    const groupsAreInformative = distinctGroups.size > 1
    const children: SidebarConfig[] = []
    let currentGroup: string | null = null
    for (const ref of visibleRefs) {
        // Headings are inserted, not sorted — an entity supplying `getGroup` must already order
        // its refs by group, or the same heading would appear more than once.
        const group = entity.getGroup?.(ref) ?? null
        if (groupsAreInformative && group && group !== currentGroup) {
            children.push({
                key: `${entity.parentKey}-group-${group}`,
                title: group,
                disabled: true,
                isDynamic: true,
                isGroupLabel: true,
            })
        }
        currentGroup = group
        children.push({
            key: `${entity.parentKey}-${ref.id}`,
            title: entity.getLabel(ref),
            link: entity.childLink(ref, projectURL),
            icon: entity.getIcon?.(ref) ?? icon(),
            isDynamic: true,
            onClick: entity.getOnClick?.(ref),
        })
    }

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
}: {
    /** The active project's URL prefix — route shape is shared, the base is the app's. */
    projectURL: string | undefined
    kindIcon?: SidebarKindIcon
}): Record<string, SidebarConfig[]> => {
    const sources = useAtomValue(sidebarEntitySourcesAtom)
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
            const idleFallback =
                cached?.projectURL === resolvedProjectURL ? cached.children : undefined
            result[key] = resolveChildren(
                entity,
                source,
                resolvedProjectURL,
                idleFallback,
                kindIcon,
            )
        }
        return result
    }, [sources, projectURL, kindIcon])

    // Keep the last non-idle children per group so a group going idle (its query
    // unsubscribing) still renders its previous items instead of the idle placeholder.
    useEffect(() => {
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
    }, [sources, projectURL, childrenByKey])

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
