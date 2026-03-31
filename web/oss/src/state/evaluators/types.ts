export interface EvaluatorConfigsParams {
    projectId?: string | null
    appId?: string | null
    preview?: boolean
}

export interface EvaluatorsParams {
    projectId?: string | null
    preview: boolean
    queriesKey: string
}
