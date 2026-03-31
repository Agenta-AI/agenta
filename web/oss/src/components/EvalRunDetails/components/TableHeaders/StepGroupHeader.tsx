import {useMemo} from "react"

import {Tooltip} from "antd"
import {atom, useAtomValue} from "jotai"

import {
    applicationReferenceQueryAtomFamily,
    testsetReferenceQueryAtomFamily,
    variantReferenceQueryAtomFamily,
} from "../../atoms/references"
import type {EvaluationTableColumnGroup} from "../../atoms/table/types"
import {
    formatReferenceLabel,
    humanizeIdentifier,
    humanizeStepKey,
    titleize,
} from "../../utils/labelHelpers"

type StepRole = "input" | "invocation" | "query"

interface QueryState<T> {
    data: T | null
    isLoading: boolean
    isFetching: boolean
    error?: unknown
}

const emptyQueryAtom = atom<QueryState<any>>({
    data: null,
    isLoading: false,
    isFetching: false,
    error: undefined,
})

const pickString = (...values: unknown[]): string | undefined =>
    values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => Boolean(value.length))

const buildQueryLabel = (refs: Record<string, any>): string | undefined => {
    const baseLabel =
        formatReferenceLabel(refs.query) ??
        formatReferenceLabel(refs.query_revision) ??
        humanizeStepKey(refs.query?.slug ?? refs.query_revision?.slug ?? refs.query?.id, "Query")
    if (!baseLabel) return undefined

    const variantLabel = formatReferenceLabel(refs.query_variant)
    const revisionVersion = refs.query_revision?.version
    const revisionLabel =
        revisionVersion !== undefined && revisionVersion !== null
            ? `Rev ${revisionVersion}`
            : formatReferenceLabel(refs.query_revision)

    const parts: string[] = [`Query ${baseLabel}`]
    if (variantLabel && variantLabel !== baseLabel) {
        parts.push(`Variant ${variantLabel}`)
    }
    if (revisionLabel && revisionLabel !== baseLabel) {
        parts.push(revisionLabel.startsWith("Rev") ? revisionLabel : `Rev ${revisionLabel}`)
    }

    return parts.join(" · ")
}

const useQueryAtom = <T,>(
    family: (param: string | null | undefined) => any,
    id: string | null | undefined,
) => {
    const derivedAtom = useMemo(() => (id ? family(id) : emptyQueryAtom), [family, id])
    return useAtomValue(derivedAtom) as QueryState<T>
}

const StepGroupHeader = ({
    group,
    fallbackLabel,
}: {
    group: EvaluationTableColumnGroup
    fallbackLabel: string
}) => {
    const meta = group.meta ?? {}
    const stepRole =
        (meta.stepRole as StepRole | undefined) ??
        (group.kind === "invocation" ? "invocation" : group.kind === "input" ? "input" : undefined)
    const refs = (meta.refs ?? {}) as Record<string, any>

    const testsetId =
        pickString(
            refs.testset?.id,
            refs.testset?.testset_id,
            refs.testset?.testsetId,
            refs.testset_id,
            refs.testsetId,
        ) ?? null
    const applicationId =
        pickString(
            refs.application?.id,
            refs.application?.app_id,
            refs.application?.appId,
            refs.application_revision?.application_id,
            refs.applicationRevision?.application_id,
            refs.application_revision?.application?.id,
            refs.applicationRevision?.application?.id,
        ) ?? null
    const variantId =
        pickString(
            refs.application_variant?.id,
            refs.application_variant?.variant_id,
            refs.application_variant?.variantId,
            refs.variant?.id,
            refs.variant?.variant_id,
            refs.variant?.variantId,
            // Extract variant_id from revision refs, not the revision id itself
            refs.application_revision?.variant_id,
            refs.applicationRevision?.variant_id,
            refs.applicationRevision?.variantId,
        ) ?? null

    const testsetQuery = useQueryAtom<{name?: string | null; slug?: string | null}>(
        testsetReferenceQueryAtomFamily,
        testsetId,
    )
    const applicationQuery = useQueryAtom<{name?: string | null; slug?: string | null}>(
        applicationReferenceQueryAtomFamily,
        applicationId,
    )
    const variantQuery = useQueryAtom<{
        name?: string | null
        slug?: string | null
        revision?: string | number | null
        version?: string | number | null
    }>(variantReferenceQueryAtomFamily, variantId)

    let label = fallbackLabel

    if (stepRole === "input") {
        const testsetName =
            humanizeIdentifier(testsetQuery.data?.name) ??
            humanizeIdentifier(testsetQuery.data?.slug) ??
            formatReferenceLabel(refs.testset)

        if (testsetName) {
            label = `Testset ${testsetName}`
        } else if (refs.query) {
            const queryLabel = buildQueryLabel(refs)
            if (queryLabel) {
                label = queryLabel
            }
        }
    } else if (stepRole === "invocation") {
        const applicationLabel =
            humanizeIdentifier(applicationQuery.data?.name) ??
            humanizeIdentifier(applicationQuery.data?.slug) ??
            formatReferenceLabel(refs.application) ??
            formatReferenceLabel(refs.agent) ??
            formatReferenceLabel(refs.tool)

        const variantLabel =
            humanizeIdentifier(variantQuery.data?.name) ??
            humanizeIdentifier(variantQuery.data?.slug) ??
            formatReferenceLabel(refs.application_variant) ??
            formatReferenceLabel(refs.variant)

        const revisionVersion =
            humanizeIdentifier(
                variantQuery.data?.revision ??
                    variantQuery.data?.version ??
                    refs.application_revision?.version ??
                    refs.applicationRevision?.version,
            ) ?? undefined

        const parts: string[] = []
        if (applicationLabel) {
            parts.push(`Application ${applicationLabel}`)
        }
        if (variantLabel && variantLabel !== applicationLabel) {
            parts.push(`Variant ${variantLabel}`)
        }
        if (revisionVersion && !parts.some((part) => part.includes(String(revisionVersion)))) {
            const normalized = String(revisionVersion).startsWith("Rev")
                ? String(revisionVersion)
                : `Rev ${revisionVersion}`
            parts.push(normalized)
        }

        if (parts.length) {
            label = parts.join(" · ")
        }
    } else if (stepRole === "query") {
        const queryLabel = buildQueryLabel(refs)
        if (queryLabel) {
            label = queryLabel
        }
    }

    const defaultLabel =
        fallbackLabel ||
        humanizeStepKey(meta.stepKey, undefined) ||
        (stepRole === "invocation"
            ? "Outputs"
            : stepRole === "input"
              ? "Inputs"
              : stepRole === "query"
                ? "Query"
                : "")

    const displayLabel =
        label ||
        defaultLabel ||
        (group.kind === "invocation"
            ? "Outputs"
            : group.kind === "input"
              ? "Inputs"
              : titleize(group.label || ""))

    return (
        <Tooltip title={displayLabel} placement="top">
            <span
                style={{
                    display: "block",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                }}
            >
                {displayLabel}
            </span>
        </Tooltip>
    )
}

export default StepGroupHeader
