import type {Workflow} from "@agenta/entities/workflow"

/**
 * The reader's own private agent. Others' private agents never reach the lists (the server
 * hides them), so a private policy here is the reader's; the owner check keeps it exact.
 */
export const isMyPrivateAgent = (
    workflow: Pick<Workflow, "access"> | null | undefined,
    currentUserId: string | null | undefined,
): boolean =>
    workflow?.access?.visibility === "private" &&
    Boolean(currentUserId) &&
    workflow.access.owner_user_id === currentUserId
