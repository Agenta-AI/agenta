import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "../../DrillInView/SchemaControls/agentTemplate/views/lazyView"
import type {SecretOwner} from "../agentSecretRules"

export interface SecretFormViewParams {
    /** The secret to edit, by its vault id. Absent: a new secret. */
    secretId?: string
    /**
     * Who may own a new secret; the first is the default. Two ask "Who can use it", one is used
     * without asking. Absent, the secret is the project's.
     */
    owners?: SecretOwner[]
}

/**
 * Create or edit a named secret: the one secret form (Settings › Secrets). Its target is the
 * project: Save stores the secret in the vault at once.
 */
export const secretFormView = defineView<SecretFormViewParams>({
    id: "secret.form",
    apply: "on_save",
    Component: lazyView(() => import("./SecretFormViewBody")),
})
