import type {AuthFailure} from "@agenta/auth"
import {useT} from "@agenta/i18n"
import sharedCatalog from "@agenta/i18n/catalogs/auth.shared"

const FAILURE_KEYS = {
    unreachable: "auth.shared.failureUnreachable",
    unavailable: "auth.shared.failureUnavailable",
    "rate-limited": "auth.shared.failureRateLimited",
    server: "auth.shared.failureServer",
    unknown: "auth.shared.failureUnknown",
} as const satisfies Record<AuthFailure, string>

/** The translated sentence for why a sign-in request failed. */
export const useAuthFailureText = () => {
    const t = useT(sharedCatalog)
    return (failure: AuthFailure) => t(FAILURE_KEYS[failure])
}
