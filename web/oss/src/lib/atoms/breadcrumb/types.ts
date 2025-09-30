import {ReactNode} from "react"

export interface BreadcrumbItem {
    label: string
    href?: string
    icon?: ReactNode
    disabled?: boolean
    menu?: BreadcrumbAtom
    value?: string
}

export type BreadcrumbAtom = Record<string, BreadcrumbItem>
