import {useCallback, useRef} from "react"

import {useDrillInUI} from "@agenta/ui/drill-in"
import type {ViewProps} from "@agenta/ui/view-stack"

import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {SkillNewViewParams} from "./skillNewView"

type Skill = Record<string, unknown>

/** The create steps of the skills bridge; each created skill is added to the agent. */
const SkillNewViewBody = ({target}: ViewProps<SkillNewViewParams>) => {
    const {skills: bridge} = useDrillInUI()
    const {update} = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    // The writer of the revision on screen now: auto-save can move it while a create runs.
    const updateRef = useRef(update)
    updateRef.current = update
    const onCreated = useCallback(
        (entries: Skill[]) =>
            updateRef.current((agent) => ({
                ...agent,
                skills: [...(Array.isArray(agent.skills) ? agent.skills : []), ...entries],
            })),
        [],
    )
    const Body = bridge?.NewSkillBody
    return Body ? <Body onCreated={onCreated} /> : null
}

export default SkillNewViewBody
