import type {ReactNode} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {
    evaluatorTemplatesMapAtom,
    parseEvaluatorKeyFromUri,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {FormattedDate, Tag} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import VariantDetailsWithStatus from "../VariantDetailsWithStatus"

import type {RevisionDrawerKind} from "./types"

const DetailRow = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex flex-col gap-1">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div>{children}</div>
    </div>
)

const VariantRow = ({
    revisionId,
    version,
}: {
    revisionId: string
    version: number | string | null | undefined
}) => {
    const variantName = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId))
    return (
        <DetailRow label="Variant">
            <VariantDetailsWithStatus
                variantName={variantName ?? undefined}
                revision={version}
                showLatestTag={false}
            />
        </DetailRow>
    )
}

// Its own component, so the evaluator catalog is fetched only for evaluator revisions.
const EvaluatorTypeRow = ({uri}: {uri: string | null | undefined}) => {
    const templates = useAtomValue(evaluatorTemplatesMapAtom)
    const key = parseEvaluatorKeyFromUri(uri)
    const label = key ? templates.get(key) : undefined
    if (!label) return null
    return <DetailRow label="Type">{label}</DetailRow>
}

// The evaluator's slug, from its workflow. A revision's own slug is an opaque id, so the row
// stays hidden until the workflow slug is known.
const EvaluatorSlugRow = ({revisionId}: {revisionId: string}) => {
    const slug = useAtomValue(workflowMolecule.selectors.artifactSlug(revisionId))
    if (!slug) return null
    return <DetailRow label="Slug">{slug}</DetailRow>
}

const DeploymentRow = ({revisionId}: {revisionId: string}) => {
    const environments = useAtomValue(environmentMolecule.atoms.revisionDeployment(revisionId))
    if (environments.length === 0) return null
    return (
        <DetailRow label="Deployment">
            <div className="flex flex-wrap gap-1">
                {environments.map((env) => (
                    <Tag key={env.id ?? env.name}>{env.name}</Tag>
                ))}
            </div>
        </DetailRow>
    )
}

/** The details column: who made the revision, when, and where it is deployed. */
export const RevisionDetails = ({
    revisionId,
    kind,
}: {
    revisionId: string
    kind: RevisionDrawerKind
}) => {
    const revision = useAtomValue(workflowMolecule.selectors.data(revisionId))
    const isEvaluator = useAtomValue(workflowMolecule.selectors.isEvaluator(revisionId))
    if (!revision) return null

    return (
        <div className="flex flex-col gap-4">
            <h3 className="m-0 text-sm font-semibold">Details</h3>
            {kind === "deployment" && (
                <VariantRow revisionId={revisionId} version={revision.version} />
            )}
            {/* The entity flag too, as /w does: a wrong kind from a host never fetches the catalog. */}
            {kind === "evaluator" && isEvaluator && <EvaluatorTypeRow uri={revision.data?.uri} />}
            {kind === "evaluator" && <EvaluatorSlugRow revisionId={revisionId} />}
            <DetailRow label="Date created">
                <FormattedDate date={revision.created_at} />
            </DetailRow>
            <DetailRow label="Created by">
                <UserAuthorLabel userId={revision.created_by_id} showPrefix={false} showAvatar />
            </DetailRow>
            {revision.message ? <DetailRow label="Note">{revision.message}</DetailRow> : null}
            <DeploymentRow revisionId={revisionId} />
        </div>
    )
}
