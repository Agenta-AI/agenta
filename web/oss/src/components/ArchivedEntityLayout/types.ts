import type {ReactNode} from "react"

export interface ArchivedEntityLayoutProps {
    title: string
    subtitle?: string
    onBack?: () => void
    children: ReactNode
}
