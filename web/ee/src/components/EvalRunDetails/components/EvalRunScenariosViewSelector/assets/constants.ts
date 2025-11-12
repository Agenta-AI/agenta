// Feature flag to toggle prototype card (list) view
export const ENABLE_CARD_VIEW = process.env.NEXT_PUBLIC_ENABLE_EVAL_CARD_VIEW === "true"

export const VIEW_HUMAN_OPTIONS = (() => {
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

export const VIEW_AUTO_OPTIONS = [
    {label: "Overview", value: "overview"},
    {label: "Testcases", value: "testcases"},
    {label: "Prompt configuration", value: "prompt"},
]

export const VIEW_ONLINE_OPTIONS = [
    {label: "Overview", value: "overview"},
    {label: "Results", value: "results"},
    {label: "Configuration", value: "configuration"},
]
