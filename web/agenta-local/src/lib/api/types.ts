export interface AgentInput {
    name: string
    instructions: string
    model: {provider: string; name: string; parameters: Record<string, unknown>}
    execution?: Record<string, unknown>
}

export type RevisionInput = Omit<AgentInput, "name">

export interface ProviderInput {
    credentials: {api_key: string}
    connection?: {base_url?: string}
}

export interface TurnInput {
    text: string
    clientTurnId: string
}
