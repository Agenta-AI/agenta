/** The MCP "Account" select options, pure so the tests and the block share the rule. */
import {USER_ACCOUNT_SOURCE, type AccountSource} from "@agenta/entities/accountChoice"

import {ACCOUNT_COPY} from "../../../../accounts/copy"
import type {PermissionPolicyOption} from "../PermissionPolicySelect"

/** The MCP select. Each person's own sign-in is left out where a person cannot sign in. */
export const mcpAccountOptions = ({
    source,
    personalAccounts,
    authMode,
}: {
    source: AccountSource
    personalAccounts: boolean
    authMode: string | undefined
}): PermissionPolicyOption[] => {
    const offerUser = (personalAccounts && authMode !== "none") || source === USER_ACCOUNT_SOURCE
    return [
        ...(offerUser ? [{value: USER_ACCOUNT_SOURCE, title: ACCOUNT_COPY.eachPersonSignIn}] : []),
        {value: "agent", title: ACCOUNT_COPY.projectSignIn},
    ]
}
