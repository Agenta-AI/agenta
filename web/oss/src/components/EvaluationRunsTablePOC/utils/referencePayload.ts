import {isUuid} from "@/oss/lib/helpers/utils"

export const buildReferencePayload = (filters: Record<string, string[]> | null | undefined) => {
    if (!filters) return undefined

    const normalizeValue = (value: string | undefined) => {
        if (!value) return undefined
        const trimmed = value.trim()
        return trimmed.length ? trimmed : undefined
    }

    const looksLikeHexId = (value: string) => /^[0-9a-f]{24}$/i.test(value)

    const entries = Object.entries(filters).flatMap(([key, values]) =>
        values
            .map((value) => {
                const normalized = normalizeValue(value)
                if (!normalized) return null
                if (key === "evaluator") {
                    const payload: {evaluator: {id?: string; slug?: string}} = {evaluator: {}}
                    if (isUuid(normalized)) {
                        payload.evaluator.id = normalized
                    } else {
                        payload.evaluator.slug = normalized
                    }
                    return payload
                }
                if (key === "query") {
                    const payload: {query: {id?: string; slug?: string}} = {query: {}}
                    if (isUuid(normalized)) {
                        payload.query.id = normalized
                    } else {
                        payload.query.slug = normalized
                    }
                    return payload
                }
                if (key === "app") {
                    return {
                        application: {id: normalized},
                    }
                }
                if (key === "variant") {
                    return {
                        application_variant: {id: normalized},
                    }
                }
                if (key === "testset") {
                    const payload: {testset: {id?: string; slug?: string}} = {testset: {}}
                    if (isUuid(normalized) || looksLikeHexId(normalized)) {
                        payload.testset.id = normalized
                    } else {
                        payload.testset.slug = normalized
                    }
                    return payload
                }
                return {
                    [key]: {slug: normalized},
                }
            })
            .filter(Boolean),
    )

    const filtered = entries.filter(Boolean) as Record<string, {slug?: string; id?: string}>[]
    return filtered.length ? filtered : undefined
}
