import {sharingMembersQueryAtomFamily} from "@agenta/entities/sharing"
import {useAtomValue} from "jotai"

import type {SharingPerson} from "./people"

/**
 * One project member's profile, from the member picker's first page (the same query the Share
 * dialog reads, so a list of shared rows costs one request). Pass null to skip the read: a hook
 * that only subscribes when a row needs a name keeps the common, unshared list at zero requests.
 * Undefined while it loads, and for someone outside the first page.
 */
export const useSharingPerson = (userId: string | null): SharingPerson | undefined => {
    const query = useAtomValue(sharingMembersQueryAtomFamily(""))
    if (!userId) return undefined
    return query.data?.members.find((member) => member.user_id === userId)
}
