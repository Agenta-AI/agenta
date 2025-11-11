import {ComponentProps} from "react"

import {Typography} from "antd"

export type ViewType = "list" | "focus"

export interface EvalRunScenarioCardProps {
    scenarioId: string
    runId: string
    viewType?: ViewType
}

export interface KeyValueProps {
    label: string
    value: any
    type?: ComponentProps<typeof Typography.Text>["type"]
}

export interface InvocationResponseProps {
    scenarioId: string
    stepKey: string
    runId?: string
}

export interface InvocationRunProps {
    invStep: any
    scenarioId: string
    runId?: string
}
