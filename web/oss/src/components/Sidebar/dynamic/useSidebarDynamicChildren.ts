import {createElement, useEffect, useMemo, useRef} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {getEntityKindIcon} from "@/oss/components/References"
import useURL from "@/oss/hooks/useURL"

import type {SidebarConfig} from "../engine/types"

import {SIDEBAR_ENTITIES, sidebarEntitySourcesAtom} from "./registry"
import {getSidebarSourceStatusLabel} from "./status"
import type {SidebarEntity, SidebarEntitySource} from "./types"

const SHOW_ALL_LABEL = "Show all"

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
): SidebarConfig[] => {
    const icon = () => entity.icon ?? getEntityKindIcon(entity.kind)
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
    const children: SidebarConfig[] = visibleRefs.map((ref) => ({
        key: `${entity.parentKey}-${ref.id}`,
        title: entity.getLabel(ref),
        link: entity.childLink(ref, projectURL),
        icon: icon(),
        isDynamic: true,
    }))

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
export const useSidebarDynamicChildren = (): Record<string, SidebarConfig[]> => {
    const {projectURL} = useURL()
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
            result[key] = resolveChildren(entity, source, resolvedProjectURL, idleFallback)
        }
        return result
    }, [sources, projectURL])

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
