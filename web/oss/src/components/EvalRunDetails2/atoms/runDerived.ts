import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {activePreviewRunIdAtom} from "./run"
import {evaluationRunQueryAtomFamily} from "./table/run"

interface RunDerivedRefs {
    applicationId: string | null
    applicationVariantId: string | null
    variantId: string | null
    rawRefs?: Record<string, any>
}

type EqualityChecker<T> = (a: T, b: T) => boolean

const shallowArrayEqual = (a: string[] | null | undefined, b: string[] | null | undefined) => {
    if (a === b) return true
    if (!a || !b) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

const primitiveEqual: EqualityChecker<any> = (a, b) => a === b

export const runDisplayNameAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        evaluationRunQueryAtomFamily(runId),
        (query) => {
            const run = query.data?.camelRun ?? query.data?.rawRun
            return run?.name ?? run?.id ?? runId ?? "—"
        },
        primitiveEqual,
    ),
)

export const runStatusAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        evaluationRunQueryAtomFamily(runId),
        (query) => {
            const run = query.data?.camelRun ?? query.data?.rawRun
            return run?.status ?? null
        },
        primitiveEqual,
    ),
)

export const runCreatedAtAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        evaluationRunQueryAtomFamily(runId),
        (query) => query.data?.camelRun?.createdAt ?? query.data?.rawRun?.created_at ?? null,
        primitiveEqual,
    ),
)

export const runUpdatedAtAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        evaluationRunQueryAtomFamily(runId),
        (query) => query.data?.camelRun?.updatedAt ?? query.data?.rawRun?.updated_at ?? null,
        primitiveEqual,
    ),
)

export const runInvocationRefsAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        evaluationRunQueryAtomFamily(runId),
        (query): RunDerivedRefs => {
            const runIndex = query.data?.runIndex
            if (!runIndex) {
                return {
                    applicationId: null,
                    applicationVariantId: null,
                    variantId: null,
                    rawRefs: undefined,
                }
            }
            const firstInvocationKey = Array.from(runIndex.invocationKeys ?? [])[0]
            const refs = firstInvocationKey
                ? (runIndex.steps?.[firstInvocationKey]?.refs ?? {})
                : {}
            const applicationId = refs.application?.id ?? null
            const applicationVariantId = refs.applicationVariant?.id ?? null
            const variantId = refs.variant?.id ?? applicationVariantId ?? null
            return {applicationId, applicationVariantId, variantId, rawRefs: refs}
        },
        (a, b) =>
            a.applicationId === b.applicationId &&
            a.applicationVariantId === b.applicationVariantId &&
            a.variantId === b.variantId,
    ),
)

export const runApplicationIdAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        runInvocationRefsAtomFamily(runId),
        (refs) => refs.applicationId ?? null,
        primitiveEqual,
    ),
)

export const runApplicationVariantIdAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        runInvocationRefsAtomFamily(runId),
        (refs) => refs.applicationVariantId ?? null,
        primitiveEqual,
    ),
)

export const runVariantIdAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        runInvocationRefsAtomFamily(runId),
        (refs) => refs.variantId ?? refs.applicationVariantId ?? null,
        primitiveEqual,
    ),
)

export const activePreviewApplicationIdAtom = atom((get) => {
    const runId = get(activePreviewRunIdAtom)
    if (!runId) return null
    return get(runApplicationIdAtomFamily(runId))
})

export const runTestsetIdsAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        evaluationRunQueryAtomFamily(runId),
        (query) => {
            const runIndex = query.data?.runIndex
            if (!runIndex) return [] as string[]
            const inputKeys = Array.from(runIndex.inputKeys ?? [])
            const ids = inputKeys
                .map((key) => runIndex.steps?.[key]?.refs?.testset?.id)
                .filter((id): id is string => Boolean(id))
            return Array.from(new Set(ids))
        },
        shallowArrayEqual,
    ),
)
