import {Alert, Button} from "@agenta/ui/ui"
import {ArrowCounterClockwise} from "@phosphor-icons/react"

import {useRestoreTestset} from "../archived/useRestoreTestset"

/**
 * Says the open test set is archived and so read only, with Restore for a reader who may edit
 * test sets. After a restore the page reloads its state and the notice goes away.
 */
export const ArchivedTestsetNotice = ({
    projectId,
    testsetId,
    canRestore,
}: {
    projectId: string
    testsetId: string
    canRestore: boolean
}) => {
    const {restore, restoring} = useRestoreTestset(projectId)
    return (
        <Alert
            type="warning"
            showIcon
            message="This test set is archived. It is read only until you restore it."
            action={
                canRestore ? (
                    <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={restoring}
                        onClick={() => void restore(testsetId)}
                    >
                        <ArrowCounterClockwise aria-hidden data-icon="inline-start" />
                        Restore
                    </Button>
                ) : undefined
            }
        />
    )
}
