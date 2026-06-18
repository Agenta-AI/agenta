import type {EvaluatorWorkflowMeta} from "@agenta/entities/workflow"

/**
 * Format an evaluator workflow's metadata as a one-line subtitle.
 *
 * @internal
 */
export function formatWorkflowMetaDescription(
    meta: EvaluatorWorkflowMeta | undefined,
): string | undefined {
    if (!meta) return undefined

    const parts: string[] = []

    if (meta.versionCount != null && meta.versionCount > 0) {
        parts.push(`${meta.versionCount} ${meta.versionCount === 1 ? "version" : "versions"}`)
    }

    const lastModifiedAt = meta.updatedAt ?? meta.createdAt
    if (lastModifiedAt) {
        const date = new Date(lastModifiedAt)
        if (!isNaN(date.getTime())) {
            parts.push(
                date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                }),
            )
        }
    }

    return parts.length > 0 ? parts.join(" · ") : undefined
}
