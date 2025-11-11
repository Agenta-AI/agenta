// Feature flag to toggle prototype card (list) view
export const ENABLE_CARD_VIEW = process.env.NEXT_PUBLIC_ENABLE_EVAL_CARD_VIEW === "true"

export const VIEW_OPTIONS = (() => {
    const base = [
        {label: "Focus view", value: "focus"},
        {label: "Table view", value: "table"},
        {label: "Results view", value: "results"},
    ]
    if (ENABLE_CARD_VIEW) {
        base.splice(1, 0, {label: "Card view", value: "list"})
    }
    return base
})()
