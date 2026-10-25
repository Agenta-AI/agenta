import {sharingMembersQueryAtomFamily} from "@agenta/entities/sharing"
import {atom, useAtomValue} from "jotai"

import type {SharingPerson} from "./people"

// Read instead of the members query when no one needs a name: no request.
const NO_MEMBERS = atom({data: undefined as undefined | {members: SharingPerson[]}})

/**
 * One project member's profile, from the member picker's first page (the same query the Share
 * dialog reads, so a list of shared rows costs one request). Pass null to skip the read: a hook
 * that only subscribes when a row needs a name keeps the common, unshared list at zero requests.
 * Undefined while it loads, and for someone outside the first page.
 */
export const useSharingPerson = (userId: string | null): SharingPerson | undefined => {
    // The members query runs only when a name is needed (opening a chat whose reader is the
    // owner reads nothing).
    const query = useAtomValue(userId ? sharingMembersQueryAtomFamily("") : NO_MEMBERS)
    if (!userId) return undefined
    return query.data?.members.find((member) => member.user_id === userId)
}
