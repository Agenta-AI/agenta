/** "Attach a secret" while its opening choice waits for the vault: the loaded fields (STATE-02). */
import {SkeletonBlock} from "@agenta/ui/ui"

import {SkeletonChoiceSwitch, SkeletonField} from "../../mcpEndpoint/components/FormSkeleton"

export const SecretAttachSkeleton = ({
    creating = false,
    owner = false,
    newSecret = true,
}: {
    /** Draws Name and Value under Secret, as "Create new secret" does. */
    creating?: boolean
    /** Draws the Owner choice of a new secret. */
    owner?: boolean
    /** Draws "New secret" beside the Secret label (pick mode, when the person can create). */
    newSecret?: boolean
}) => (
    <div aria-hidden className="flex flex-col gap-3" data-testid="secret-attach-skeleton">
        <SkeletonField label="w-12" labelEnd={newSecret && !creating}>
            <SkeletonBlock className="h-control rounded-control" />
        </SkeletonField>
        {creating ? (
            <>
                <SkeletonField label="w-10">
                    <SkeletonBlock className="h-control rounded-control" />
                </SkeletonField>
                <SkeletonField label="w-10">
                    {/* The kit textarea at one row: 20px line, 8px padding, 1px border. */}
                    <SkeletonBlock className="h-9.5 rounded-control" />
                </SkeletonField>
                {owner ? (
                    <SkeletonField label="w-12">
                        <SkeletonChoiceSwitch />
                    </SkeletonField>
                ) : null}
            </>
        ) : null}
        <SkeletonField label="w-32">
            <SkeletonBlock className="h-control rounded-control" />
        </SkeletonField>
    </div>
)
