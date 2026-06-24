export interface EvaluationStepSlot<
    Kind extends string,
    SlotKind extends Kind = Kind,
    Preset = unknown,
> {
    kind: SlotKind
    required?: boolean
    hidden?: boolean
    locked?: boolean
    preset?: Preset
    dependsOn?: Kind[]
}

export interface EvaluationStepDescriptor<Kind extends string, Value, Context, Payload> {
    kind: Kind
    defaultValue: Value
    isComplete: (value: Value, context: Context) => boolean
    toPayload?: (value: Value, context: Context) => Promise<Partial<Payload>>
}

export type EvaluationStepDescriptorMap<
    Kind extends string,
    Values extends Record<Kind, unknown>,
    Context,
    Payload,
> = {
    [StepKind in Kind]: EvaluationStepDescriptor<StepKind, Values[StepKind], Context, Payload>
}

export const assertValidStepConfig = <Kind extends string>(
    slots: EvaluationStepSlot<Kind>[],
    knownKinds: ReadonlySet<Kind>,
) => {
    const configuredKinds = new Set<Kind>()

    for (const slot of slots) {
        if (!knownKinds.has(slot.kind)) throw new Error(`Unknown evaluation step: ${slot.kind}`)
        if (configuredKinds.has(slot.kind)) {
            throw new Error(`Duplicate evaluation step: ${slot.kind}`)
        }
        configuredKinds.add(slot.kind)
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

export const isEvaluationStepEnabled = <
    Kind extends string,
    Values extends Record<Kind, unknown>,
    Context,
    Payload,
>(
    slot: EvaluationStepSlot<Kind>,
    descriptors: EvaluationStepDescriptorMap<Kind, Values, Context, Payload>,
    getValue: <StepKind extends Kind>(kind: StepKind) => Values[StepKind],
    context: Context,
) => (slot.dependsOn ?? []).every((kind) => descriptors[kind].isComplete(getValue(kind), context))

export const findInitialEvaluationStep = <
    Kind extends string,
    Values extends Record<Kind, unknown>,
    Context,
    Payload,
>(
    slots: EvaluationStepSlot<Kind>[],
    descriptors: EvaluationStepDescriptorMap<Kind, Values, Context, Payload>,
    getValue: <StepKind extends Kind>(kind: StepKind) => Values[StepKind],
    context: Context,
    isVisible: (slot: EvaluationStepSlot<Kind>) => boolean = (slot) => !slot.hidden,
) => {
    const candidates = slots.filter(
        (slot) => isVisible(slot) && isEvaluationStepEnabled(slot, descriptors, getValue, context),
    )
    return (
        candidates.find((slot) => !descriptors[slot.kind].isComplete(getValue(slot.kind), context))
            ?.kind ??
        candidates[0]?.kind ??
        null
    )
}

export const findNextEvaluationStep = <
    Kind extends string,
    Values extends Record<Kind, unknown>,
    Context,
    Payload,
>(
    currentKind: Kind,
    slots: EvaluationStepSlot<Kind>[],
    descriptors: EvaluationStepDescriptorMap<Kind, Values, Context, Payload>,
    getValue: <StepKind extends Kind>(kind: StepKind) => Values[StepKind],
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
                !descriptors[slot.kind].isComplete(getValue(slot.kind), context),
        )?.kind ?? null
    )
}

export const findFirstIncompleteRequiredStep = <
    Kind extends string,
    Values extends Record<Kind, unknown>,
    Context,
    Payload,
>(
    slots: EvaluationStepSlot<Kind>[],
    descriptors: EvaluationStepDescriptorMap<Kind, Values, Context, Payload>,
    getValue: <StepKind extends Kind>(kind: StepKind) => Values[StepKind],
    context: Context,
) =>
    slots.find(
        (slot) => slot.required && !descriptors[slot.kind].isComplete(getValue(slot.kind), context),
    )?.kind ?? null

export const composeEvaluationStepPayload = async <
    Kind extends string,
    Values extends Record<Kind, unknown>,
    Context,
    Payload extends object,
>(
    slots: EvaluationStepSlot<Kind>[],
    descriptors: EvaluationStepDescriptorMap<Kind, Values, Context, Payload>,
    getValue: <StepKind extends Kind>(kind: StepKind) => Values[StepKind],
    context: Context,
): Promise<Partial<Payload>> => {
    let payload: Partial<Payload> = {}
    for (const slot of slots) {
        const descriptor = descriptors[slot.kind]
        if (!descriptor.toPayload) continue
        payload = {
            ...payload,
            ...(await descriptor.toPayload(getValue(slot.kind), context)),
        }
    }
    return payload
}

export const splitEvaluationPayloadByInvocationStep = <
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
