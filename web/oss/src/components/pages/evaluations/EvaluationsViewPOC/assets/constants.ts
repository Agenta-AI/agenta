import {type EvaluationRunKind} from "../../../../EvaluationRunsTablePOC"

export const tabColorMap: Record<EvaluationRunKind, string> = {
    all: "#e0f2fe",
    auto: "#dbeafe",
    human: "#ede9fe",
    online: "#dcfce7",
    custom: "#fce7f3",
}

export const tabItems: {key: EvaluationRunKind; label: string}[] = [
    {key: "all", label: "All Evaluations"},
    {key: "auto", label: "Auto Evaluations"},
    {key: "human", label: "Human Evaluations"},
    {key: "online", label: "Online Evaluations"},
    {key: "custom", label: "SDK Evaluations"},
]
