import {atom, type Atom} from "jotai"

import type {WorkspaceMember} from "./types"

const fallbackMembersAtom = atom<WorkspaceMember[]>([])
const membersSourceAtom = atom<Atom<WorkspaceMember[]>>(fallbackMembersAtom)

/**
 * Current workspace's members — the host seam for author attribution.
 *
 * Package code that resolves a record's author (annotations, for one) reads
 * this instead of an org store. OSS binds its `selectedOrg.default_workspace`
 * members; mobile leaves the default empty, in which case ids render raw.
 */
export const workspaceMembersAtom = atom((get) => get(get(membersSourceAtom)))

/** Host seam: point the member list at one of the host's own atoms. */
export const bindWorkspaceMembersAtom = atom(null, (_get, set, source: Atom<WorkspaceMember[]>) =>
    set(membersSourceAtom, source),
)
