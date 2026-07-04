export interface WorkspaceModalProps {
    open: boolean
    onClose: () => void
}

export interface GenerateResetLinkModalProps extends WorkspaceModalProps {
    username: string | undefined
    onConfirm: () => void
}

export interface PasswordResetLinkModalProps extends WorkspaceModalProps {
    username: string | undefined
    generatedLink: string
}

export interface InvitedUserLinkModalProps extends WorkspaceModalProps {
    invitedUserData: {email: string; uri: string}
}

export interface InviteUsersModalProps extends WorkspaceModalProps {
    setQueryInviteModalOpen: (val: string) => void
    onSuccess?: (data: {email: string; uri: string} | null) => void
    workspaceId: string
}
