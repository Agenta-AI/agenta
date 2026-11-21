import {memo} from "react"

import type {SpanCategory, SpanReference} from "@agenta/entities/trace"
import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {NodeNameCell} from "./NodeNameCell"

const APP_REFERENCE_KEYS = ["application", "workflow", "agent"]

/** The id of the app or agent a span references, if any. */
const appReferenceId = (references?: SpanReference[] | null) =>
    references?.find((ref) => APP_REFERENCE_KEYS.includes(String(ref.attributes?.key ?? "")))?.id

const ArtifactNameCell = ({
    entityId,
    name,
    type,
}: {
    entityId: string
    name?: string | null
    type?: SpanCategory | null
}) => {
    const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(entityId))
    return <NodeNameCell name={artifactName || name} type={type} />
}

/** A span's name; an SDK placeholder ("_agent") shows the referenced app or agent name. */
export const SpanNameCell = memo(
    ({
        name,
        type,
        references,
    }: {
        name?: string | null
        type?: SpanCategory | null
        references?: SpanReference[] | null
    }) => {
        const entityId = name?.startsWith("_") ? appReferenceId(references) : undefined
        if (!entityId) return <NodeNameCell name={name} type={type} />
        return <ArtifactNameCell entityId={entityId} name={name} type={type} />
    },
)

export default SpanNameCell
