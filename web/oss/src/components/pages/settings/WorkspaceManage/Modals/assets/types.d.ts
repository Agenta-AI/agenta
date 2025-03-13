import {ModalProps, FormInstance} from "antd"

export interface GenerateResetLinkModalProps extends ModalProps {
    username: string | undefined
}

export interface PasswordResetLinkModalProps extends ModalProps {
    username: string | undefined
    generatedLink: string
}

export interface InvitedUserLinkModalProps extends ModalProps {
    invitedUserData: {email: string; uri: string}
}

export interface InviteUsersModalProps extends ModalProps {
    setQueryInviteModalOpen: (val: string) => void
    onSuccess?: (data: {email: string; uri: string} | null) => void
    workspaceId: string
}

export interface InviteFormProps {
    form: FormInstance
    setLoading: React.Dispatch<React.SetStateAction<boolean>>
    onSuccess?: (data: {email: string; uri: string} | null) => void
    workspaceId: string
}
