export interface EvaluatorData {
    service: {
        agenta: string
        format: {
            type: "object"
            $schema: string
            required: string[]
            properties: {
                outputs: {
                    type: "object"
                    properties: Record<string, any>
                    required: string[]
                }
            }
        }
    }
}

export interface EvaluatorDto {
    name: string
    slug: string
    id: string
    created_at: string
    created_by_id: string
    data: EvaluatorData
}

export interface EvaluatorResponseDto {
    evaluator: EvaluatorDto[]
    count: number
}
