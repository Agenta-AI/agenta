import {createElement, useMemo, useRef} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {getEntityKindIcon} from "@/oss/components/References"
import useURL from "@/oss/hooks/useURL"

import type {SidebarConfig} from "../engine/types"

import {SIDEBAR_ENTITIES, sidebarEntitySourcesAtom} from "./registry"
import type {SidebarEntity, SidebarEntitySource} from "./types"

const PLACEHOLDER_LABEL = "Open to load"
const LOADING_LABEL = "Loading"
const SHOW_ALL_LABEL = "Show all"

/**
 * Maps one entity's gated source to menu children. Always returns ≥1 child — an
 * empty submenu would strip the parent's expand caret, leaving no way to open the
 * group (and so no way to trigger the gated fetch). Placeholders are disabled.
 */
const resolveChildren = (
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
                title: PLACEHOLDER_LABEL,
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
                title: LOADING_LABEL,
                icon: icon(),
                disabled: true,
                isDynamic: true,
                isLoading: true,
            },
        ]
    }

    const refs = source?.refs ?? []
    if (!refs.length) {
        return [
            {
                key: `${entity.parentKey}-empty`,
                title: entity.emptyLabel ?? "No items",
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

    return useMemo(() => {
        const resolvedProjectURL = projectURL ?? ""
        const cachedChildren = cachedChildrenRef.current ?? {}
        const sourcesByKey = sources ?? {}
        const childrenByKey: Record<string, SidebarConfig[]> = {}
        for (const [key, entity] of Object.entries(SIDEBAR_ENTITIES)) {
            const source = sourcesByKey[key]
            const cached = cachedChildren[key]
            const idleFallback =
                cached?.projectURL === resolvedProjectURL ? cached.children : undefined
            const children = resolveChildren(entity, source, resolvedProjectURL, idleFallback)

            childrenByKey[key] = children

            if (source?.status && source.status !== "idle") {
                cachedChildren[key] = {projectURL: resolvedProjectURL, children}
            }
        }
        cachedChildrenRef.current = cachedChildren
        return childrenByKey
    }, [sources, projectURL])
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
