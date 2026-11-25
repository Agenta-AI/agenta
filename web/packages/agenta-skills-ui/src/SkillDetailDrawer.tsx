/**
 * The Skills page's skill drawer: a thin drawer around the one skill view (the registry skill
 * body the agent's skill view renders too). Hosts keep their props.
 */
import {useMemo} from "react"

import type {RegistrySkillParams} from "@agenta/ui/drill-in"
import {ViewDrawerHost, type ViewRequest} from "@agenta/ui/view-stack"

import {registrySkillView} from "./registrySkillView"
import {SkillAgentHrefContext} from "./RegistrySkillViewBody"
import type {SkillListItem} from "./types"

export {skillRevisionsQueryKey} from "./RegistrySkillViewBody"

export interface SkillDetailDrawerProps {
    open: boolean
    onClose: () => void
    /** The project is read from the app state; kept so hosts do not change. */
    projectId?: string
    /** The clicked row. Null renders nothing. */
    skill: SkillListItem | null
    /** Where an agent's name in "Used by" leads. Absent, the names are plain text. */
    agentHref?: (agentId: string) => string
    width?: number
}

export function SkillDetailDrawer({
    open,
    onClose,
    skill,
    agentHref,
    width,
}: SkillDetailDrawerProps) {
    // A registry skill is addressed by its workflow slug, as an embed reference stores it.
    const slug = skill?.workflowSlug ?? ""
    const request = useMemo<ViewRequest<RegistrySkillParams>>(
        () => ({view: registrySkillView, params: {slug}, target: {kind: "project"}}),
        [slug],
    )
    if (!open || !skill) return null
    return (
        <SkillAgentHrefContext.Provider value={agentHref ?? null}>
            <ViewDrawerHost key={skill.id} request={request} onClosed={onClose} width={width} />
        </SkillAgentHrefContext.Provider>
    )
}
