import {queryClient} from "@agenta/shared/api"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {selectedOrgQueryAtom} from "@/oss/state/org/selectors/org"
import {profileQueryAtom} from "@/oss/state/profile/selectors/user"
import {projectsQueryAtom} from "@/oss/state/project/selectors/project"
import {protectedRouteLatchedReadyAtom} from "@/oss/state/url/auth"

const noop = () => undefined

let warmed = false

// First evaluation of the boot atom graph off the big provider-mount commit. Safe
// pre-auth: every query atom is enabled-gated on sessionExistsAtom (still false here).
export const prewarmBootQueryGraph = () => {
    if (warmed || typeof window === "undefined") return
    warmed = true

    const store = getDefaultStore()
    // Same singleton HydrateAtoms hydrates later; needed now so observers bind to it
    store.set(queryClientAtom, queryClient)
    store.sub(profileQueryAtom, noop)
    store.sub(projectsQueryAtom, noop)
    store.sub(selectedOrgQueryAtom, noop)
    store.sub(protectedRouteLatchedReadyAtom, noop)
}
