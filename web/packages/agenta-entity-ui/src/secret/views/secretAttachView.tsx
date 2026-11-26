import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "../../DrillInView/SchemaControls/agentTemplate/views/lazyView"
import {SecretAttachSkeleton} from "../attach/SecretAttachSkeleton"

export interface SecretAttachViewParams {
    /** The attachment to edit, by its environment variable. Absent: a new attachment. */
    envVar?: string
}

/**
 * "Attach a secret" (F04 f4 to f7). The attach saves a new agent version at once, as production
 * does (`commitAgentCredentialsAtom`); a new secret goes to the vault first.
 */
export const secretAttachView = defineView<SecretAttachViewParams>({
    id: "agent.secret.attach",
    apply: "on_save",
    Component: lazyView(
        () => import("./SecretAttachViewBody"),
        // The body's padding around the most common opening: pick an existing secret.
        <div className="px-4 py-3">
            <SecretAttachSkeleton />
        </div>,
    ),
})
