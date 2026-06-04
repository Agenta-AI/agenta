export interface PlaygroundDrawerResultPayload {
    status?: string
    output?: unknown
    traceId?: string | null
    error?: unknown
}

export interface PlaygroundDrawerOutputNodePayload {
    id: string
    name: string
    result: PlaygroundDrawerResultPayload | null
    downstream: PlaygroundDrawerOutputNodePayload[]
}

export interface PlaygroundDrawerPayload {
    inputs: Record<string, unknown>
    suggestedFields: {key: string; label: string; type: string}[]
    outputs: {
        variants: PlaygroundDrawerOutputNodePayload[]
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

export function buildPlaygroundDrawerPayload({
    inputs,
    suggestedFields,
    outputs,
}: PlaygroundDrawerPayload): PlaygroundDrawerPayload {
    return {
        inputs,
        suggestedFields,
        outputs,
    }
}

export function applyPlaygroundDrawerPayloadEdit({
    currentInputs,
    nextPayload,
}: {
    currentInputs: Record<string, unknown>
    nextPayload: unknown
}): Record<string, unknown> {
    if (!isRecord(nextPayload) || !isRecord(nextPayload.inputs)) {
        return currentInputs
    }

    return nextPayload.inputs
}

export function toPlaygroundDrawerResultPayload(
    result: unknown,
): PlaygroundDrawerResultPayload | null {
    if (!isRecord(result)) return null

    return {
        status: typeof result.status === "string" ? result.status : undefined,
        output: result.output,
        traceId: typeof result.traceId === "string" ? result.traceId : null,
        error: result.error,
    }
}
