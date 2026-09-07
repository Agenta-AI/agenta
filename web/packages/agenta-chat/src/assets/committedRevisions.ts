import type {SessionRecord} from "@agenta/entities/session"
import {canonicalClientToolName} from "@agenta/shared/clientTools"

export interface CommittedRevision {
    variantId: string
    revisionId: string
    version: string
}

const committedRevisionData = (output: unknown): CommittedRevision | null => {
    let value = output
    if (typeof value === "string") {
        try {
            value = JSON.parse(value)
        } catch {
            return null
        }
    }
    if (!value || typeof value !== "object") return null
    const payload = value as Record<string, unknown>
    if (payload.status !== "committed" && !payload.count) return null
    if (!payload.workflow_revision || typeof payload.workflow_revision !== "object") return null
    const revision = payload.workflow_revision as Record<string, unknown>
    const variantId = revision.workflow_variant_id ?? revision.variant_id
    const revisionId = revision.id ?? revision.workflow_revision_id ?? revision.revision_id
    const version = revision.version
    if (
        typeof variantId !== "string" ||
        !variantId ||
        typeof revisionId !== "string" ||
        !revisionId ||
        (typeof version !== "string" && typeof version !== "number") ||
        !String(version)
    )
        return null
    return {variantId, revisionId, version: String(version)}
}

/** Notifications learned during this mounted reader, never historical side effects. */
export const liveCommittedRevisions = (
    records: SessionRecord[],
    afterSequence?: number,
): CommittedRevision[] => {
    if (afterSequence === undefined) return []
    const names = new Map<string, string>()
    const revisions = new Map<string, CommittedRevision>()
    for (const row of records) {
        const payload = row.payload
        if (!payload || typeof payload.id !== "string") continue
        if (payload.type === "tool_call" && typeof payload.name === "string")
            names.set(payload.id, canonicalClientToolName(payload.name))
        if (
            payload.type !== "tool_result" ||
            payload.isError ||
            payload.denied ||
            typeof row.sequence !== "number" ||
            row.sequence <= afterSequence ||
            names.get(payload.id) !== "commit_revision"
        )
            continue
        const revision = committedRevisionData(payload.data ?? payload.output)
        if (revision) revisions.set(revision.revisionId, revision)
    }
    return [...revisions.values()]
}
