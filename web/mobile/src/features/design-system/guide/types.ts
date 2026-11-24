import type {ReactNode} from "react"

/** A rule's live examples. Its title, reason, Avoid, Do and checks come from rules.json. */
export interface RuleExample {
    id: string
    do: {example: ReactNode; caption: string; code?: string}
    avoid: {example: ReactNode; caption: string}
}

/** A rule as the guide shows it: its rules.json entry plus its examples. */
export interface GuideRule extends RuleExample {
    title: string
    why: string
    avoidText: string
    doText: string
    group: string
    checkedBy: ("ratchet" | "lint" | "review")[]
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
