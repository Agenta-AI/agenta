import {AgentNameInline as SharedAgentNameInline} from "@agenta/entity-ui/agent"

import {useRenameApp} from "./useRenameApp"

interface AgentNameInlineProps {
    /** Workflow (artifact) id — the rename target. */
    workflowId: string
    name: string
    /** Reflect a committed name back to the header (it keeps showing the live name). */
    onRenamed: (name: string) => void
}

/** The shared inline editor, committing through the desktop's rename so app-management refreshes too. */
const AgentNameInline = ({workflowId, name, onRenamed}: AgentNameInlineProps) => {
    const {renameApp, isDuplicateName} = useRenameApp()

    return (
        <SharedAgentNameInline
            workflowId={workflowId}
            name={name}
            onRenamed={onRenamed}
            onRename={(id, next) => renameApp({id, name: next})}
            isDuplicateName={isDuplicateName}
        />
    )
}

export default AgentNameInline
