import {atom} from "jotai"

/** Which session the Share dialog is open for. One dialog for the app, opened from any surface. */
export interface ShareDialogRequest {
    sessionId: string
    sessionName: string
    workspaceId: string
    projectId: string
    /** The session's agent, for the personal accounts line. Absent when the opener does not know. */
    agentId?: string | null
}

export const shareDialogRequestAtom = atom<ShareDialogRequest | null>(null)
