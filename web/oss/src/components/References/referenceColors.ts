export type ReferenceTone = "app" | "variant" | "testset" | "query" | "evaluator"

export interface ReferenceToneColors {
    text: string
    background: string
    border: string
}

const REFERENCE_TONE_COLORS: Record<ReferenceTone, ReferenceToneColors> = {
    app: {
        text: "#175CD3",
        background: "#EFF8FF",
        border: "#B2DDFF",
    },
    variant: {
        text: "#027A48",
        background: "#ECFDF3",
        border: "#ABEFC6",
    },
    testset: {
        text: "#5925DC",
        background: "#F4EBFF",
        border: "#D6BBFB",
    },
    query: {
        text: "#B93815",
        background: "#FEF6EE",
        border: "#F9DBAF",
    },
    evaluator: {
        text: "#C01048",
        background: "#FFF1F3",
        border: "#FCCEEE",
    },
}

export const getReferenceToneColors = (tone?: ReferenceTone | null) =>
    tone ? (REFERENCE_TONE_COLORS[tone] ?? null) : null
