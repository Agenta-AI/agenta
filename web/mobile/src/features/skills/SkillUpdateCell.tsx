import {Button, Spinner} from "@agenta/ui/ui"

import {useSkillUpdates, useSkillUpdateStatus} from "./useSkillUpdates"

/**
 * What a row or a card says beside its kebab once someone checked upstream: an Update button
 * while one is waiting, "Updated" once it landed, nothing otherwise. Reads the shared answer,
 * so the group heading's count and this button can never disagree.
 */
export const SkillUpdateCell = ({workflowId}: {workflowId: string}) => {
    const status = useSkillUpdateStatus(workflowId)
    const {apply} = useSkillUpdates()

    if (status === "checking") return <Spinner size="small" className="text-muted-foreground" />
    if (status === "available")
        return (
            <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11.5px] font-normal"
                onClick={() => void apply([workflowId])}
            >
                Update
            </Button>
        )
    if (status === "updated")
        return <span className="text-[12px] text-muted-foreground">Updated</span>
    return null
}
