export interface FocusDrawerResultPayload {
    status?: string
    output?: unknown
    traceId?: string | null
    error?: unknown
}

export interface FocusDrawerOutputNodePayload {
    id: string
    name: string
    result: FocusDrawerResultPayload | null
    downstream: FocusDrawerOutputNodePayload[]
}

export interface FocusDrawerPayload {
    // The index signature lets the payload pass as the editor's record value.
    [key: string]: unknown
    inputs: Record<string, unknown>
    suggestedFields: {key: string; label: string; type: string}[]
    outputs: {
        variants: FocusDrawerOutputNodePayload[]
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

/** The JSON or YAML view of the drawer shows the row's inputs, the columns it lacks and its outputs. */
export const buildFocusDrawerPayload = ({
    inputs,
    suggestedFields,
    outputs,
}: FocusDrawerPayload): FocusDrawerPayload => ({inputs, suggestedFields, outputs})

/** An edit of the JSON or YAML view writes back only `inputs`; the rest is read only. */
export const applyFocusDrawerPayloadEdit = ({
    currentInputs,
    nextPayload,
}: {
    currentInputs: Record<string, unknown>
    nextPayload: unknown
}): Record<string, unknown> =>
    isRecord(nextPayload) && isRecord(nextPayload.inputs) ? nextPayload.inputs : currentInputs

export const toFocusDrawerResultPayload = (result: unknown): FocusDrawerResultPayload | null => {
    if (!isRecord(result)) return null
    return {
        status: typeof result.status === "string" ? result.status : undefined,
        output: result.output,
        traceId: typeof result.traceId === "string" ? result.traceId : null,
        error: result.error,
    }
}
