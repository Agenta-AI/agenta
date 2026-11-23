import type {ReactNode} from "react"

/** One rule: the same ID as in DESIGN.md, a Do and an Avoid example, and how it is checked. */
export interface GuideRule {
    id: string
    title: string
    why: string
    do: {example: ReactNode; caption: string; code?: string}
    avoid: {example: ReactNode; caption: string}
    checkedBy: ("lint" | "ratchet" | "test" | "review")[]
}

export interface GuidePage {
    id: string
    group: "Overview" | "Foundations" | "Components" | "Patterns"
    title: string
    tagline: string
    specimen?: ReactNode
    /** Props and variants of the page's component, as a short table. */
    api?: {prop: string; values: string; note?: string}[]
    /** A copy-paste example of the page's component. */
    code?: string
    rules: GuideRule[]
}
