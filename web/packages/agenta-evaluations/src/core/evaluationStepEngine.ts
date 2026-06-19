export interface EvaluationStepSlot<Kind extends string> {
    kind: Kind
    required?: boolean
    hidden?: boolean
    locked?: boolean
    preset?: unknown
    dependsOn?: Kind[]
}

export interface EvaluationStepDescriptor<Value, Context, Payload> {
    kind: string
    defaultValue: Value
    isComplete: (value: Value, context: Context) => boolean
    toPayload?: (value: Value, context: Context) => Promise<Partial<Payload>>
}

export type EvaluationStepDescriptorMap<Kind extends string, Context, Payload> = Record<
    Kind,
    EvaluationStepDescriptor<never, Context, Payload>
>

export const assertValidStepConfig = <Kind extends string>(
    slots: EvaluationStepSlot<Kind>[],
    knownKinds: ReadonlySet<Kind>,
    mutuallyExclusiveGroups: readonly (readonly Kind[])[] = [],
) => {
    const configuredKinds = new Set<Kind>()

    for (const slot of slots) {
        if (!knownKinds.has(slot.kind)) throw new Error(`Unknown evaluation step: ${slot.kind}`)
        if (configuredKinds.has(slot.kind)) {
            throw new Error(`Duplicate evaluation step: ${slot.kind}`)
        }
        configuredKinds.add(slot.kind)
    }

    for (const group of mutuallyExclusiveGroups) {
        const configuredGroup = group.filter((kind) => configuredKinds.has(kind))
        if (configuredGroup.length > 1) {
            throw new Error(
                `Mutually exclusive evaluation steps configured: ${configuredGroup.join(", ")}`,
            )
        }
    }

    for (const slot of slots) {
        for (const dependency of slot.dependsOn ?? []) {
            if (!configuredKinds.has(dependency)) {
                throw new Error(
                    `Evaluation step "${slot.kind}" depends on missing step "${dependency}"`,
                )
            }
        }
    }

    const visiting = new Set<Kind>()
    const visited = new Set<Kind>()
    const visit = (kind: Kind) => {
        if (visited.has(kind)) return
        if (visiting.has(kind)) {
            throw new Error(`Cyclic evaluation step dependency involving "${kind}"`)
        }
        visiting.add(kind)
        const slot = slots.find((candidate) => candidate.kind === kind)
        for (const dependency of slot?.dependsOn ?? []) visit(dependency)
        visiting.delete(kind)
        visited.add(kind)
    }

    for (const slot of slots) visit(slot.kind)
}

export const isEvaluationStepEnabled = <Kind extends string, Context, Payload>(
    slot: EvaluationStepSlot<Kind>,
    descriptors: EvaluationStepDescriptorMap<Kind, Context, Payload>,
    getValue: (kind: Kind) => unknown,
    context: Context,
) =>
    (slot.dependsOn ?? []).every((kind) =>
        descriptors[kind].isComplete(getValue(kind) as never, context),
    )

export const findInitialEvaluationStep = <Kind extends string, Context, Payload>(
    slots: EvaluationStepSlot<Kind>[],
    descriptors: EvaluationStepDescriptorMap<Kind, Context, Payload>,
    getValue: (kind: Kind) => unknown,
    context: Context,
    isVisible: (slot: EvaluationStepSlot<Kind>) => boolean = (slot) => !slot.hidden,
) => {
    const candidates = slots.filter(
        (slot) => isVisible(slot) && isEvaluationStepEnabled(slot, descriptors, getValue, context),
    )
    return (
        candidates.find(
            (slot) => !descriptors[slot.kind].isComplete(getValue(slot.kind) as never, context),
        )?.kind ??
        candidates[0]?.kind ??
        null
    )
}

export const findNextEvaluationStep = <Kind extends string, Context, Payload>(
    currentKind: Kind,
    slots: EvaluationStepSlot<Kind>[],
    descriptors: EvaluationStepDescriptorMap<Kind, Context, Payload>,
    getValue: (kind: Kind) => unknown,
    context: Context,
    isVisible: (slot: EvaluationStepSlot<Kind>) => boolean = (slot) => !slot.hidden,
) => {
    const currentIndex = slots.findIndex((slot) => slot.kind === currentKind)
    const ordered = [...slots.slice(currentIndex + 1), ...slots.slice(0, currentIndex + 1)]
    return (
        ordered.find(
            (slot) =>
                isVisible(slot) &&
                isEvaluationStepEnabled(slot, descriptors, getValue, context) &&
                !descriptors[slot.kind].isComplete(getValue(slot.kind) as never, context),
        )?.kind ?? null
    )
}

export const findFirstIncompleteRequiredStep = <Kind extends string, Context, Payload>(
    slots: EvaluationStepSlot<Kind>[],
    descriptors: EvaluationStepDescriptorMap<Kind, Context, Payload>,
    getValue: (kind: Kind) => unknown,
    context: Context,
) =>
    slots.find(
        (slot) =>
            slot.required &&
            !descriptors[slot.kind].isComplete(getValue(slot.kind) as never, context),
    )?.kind ?? null

export const composeEvaluationStepPayload = async <
    Kind extends string,
    Context,
    Payload extends object,
>(
    slots: EvaluationStepSlot<Kind>[],
    descriptors: EvaluationStepDescriptorMap<Kind, Context, Payload>,
    getValue: (kind: Kind) => unknown,
    context: Context,
): Promise<Partial<Payload>> => {
    let payload: Partial<Payload> = {}
    for (const slot of slots) {
        const descriptor = descriptors[slot.kind]
        if (!descriptor.toPayload) continue
        payload = {
            ...payload,
            ...(await descriptor.toPayload(getValue(slot.kind) as never, context)),
        }
    }
    return payload
}

export const splitEvaluationPayloadByApplicationStep = <
    Payload extends {
        application_steps?: string[] | Record<string, unknown> | null
    },
>(
    payload: Payload,
): Payload[] => {
    const applicationSteps = payload.application_steps
    const revisionIds = Array.isArray(applicationSteps)
        ? applicationSteps
        : Object.keys(applicationSteps ?? {})

    if (!revisionIds.length) return [payload]

    return revisionIds.map((revisionId) => ({
        ...payload,
        application_steps: {
            [revisionId]: Array.isArray(applicationSteps) ? "auto" : applicationSteps?.[revisionId],
        },
    }))
}
