import {atom} from "jotai"
import {ReactNode} from "react"

export interface BreadcrumbItem {
    label: string
    href?: string
    icon?: ReactNode
    disabled?: boolean
    menu?: BreadcrumbAtom
    value?: string
}

export interface BreadcrumbAtom {
    [key: string]: BreadcrumbItem
}

// Main breadcrumb state atom
export const breadcrumbAtom = atom<BreadcrumbAtom | null>(null)

// Helper atom to set breadcrumbs
export const setBreadcrumbsAtom = atom(null, (get, set, breadcrumbs: BreadcrumbAtom | null) => {
    set(breadcrumbAtom, breadcrumbs)
})

// Helper atom to append a breadcrumb item
export const appendBreadcrumbAtom = atom(null, (get, set, item: BreadcrumbAtom) => {
    const current = get(breadcrumbAtom) || {}
    set(breadcrumbAtom, {...current, ...item})
})

// Helper atom to prepend a breadcrumb item
export const prependBreadcrumbAtom = atom(null, (get, set, item: BreadcrumbAtom) => {
    const current = get(breadcrumbAtom) || {}
    set(breadcrumbAtom, {...current, ...item})
})

// Helper atom to clear breadcrumbs (reset to URL-based)
export const clearBreadcrumbsAtom = atom(null, (get, set) => {
    set(breadcrumbAtom, {})
})
