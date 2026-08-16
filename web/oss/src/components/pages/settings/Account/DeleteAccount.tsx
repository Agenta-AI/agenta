import {AccountPage} from "@agenta/settings-ui"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {Trash} from "@phosphor-icons/react"
import {useMutation} from "@tanstack/react-query"
import {message} from "antd"

import {useSession} from "@/oss/hooks/useSession"
import {deleteAccount} from "@/oss/services/profile"
import {useProfileData} from "@/oss/state/profile"

/** OSS binding: the shared account page, with this app's delete call and confirm modal. */
const DeleteAccount = () => {
    const {user} = useProfileData()
    const {logout} = useSession()

    const deleteMutation = useMutation({
        mutationFn: deleteAccount,
        onSuccess: async () => {
            message.success("Your account has been deleted")
            // logout() signs out of SuperTokens, clears caches, and redirects.
            await logout()
        },
        onError: (error: any) => {
            message.error(error?.message || "Unable to delete account")
        },
    })

    return (
        <AccountPage
            username={user?.username}
            email={user?.email}
            deleting={deleteMutation.isPending}
            onDeleteAccount={() => deleteMutation.mutate()}
            renderConfirm={({open, onClose, onConfirm, confirmed, body}) => (
                <EnhancedModal
                    title="Delete account"
                    open={open}
                    okText="Delete account"
                    okType="danger"
                    okButtonProps={{
                        icon: <Trash size={14} />,
                        type: "primary",
                        disabled: !confirmed,
                    }}
                    onCancel={onClose}
                    onOk={onConfirm}
                    confirmLoading={deleteMutation.isPending}
                    width={450}
                >
                    {body}
                </EnhancedModal>
            )}
        />
    )
}

export default DeleteAccount
