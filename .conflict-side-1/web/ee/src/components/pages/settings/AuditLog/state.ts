import {atom} from "jotai"

/**
 * UI state for the audit-log detail drawer.
 *
 * The selected event id is resolved against the entity session cache
 * (`eventByIdAtomFamily`) — the drawer never fetches on its own.
 */
export const selectedEventIdAtom = atom<string | null>(null)

export const auditDrawerOpenAtom = atom<boolean>(false)
