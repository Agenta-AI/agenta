import {useState} from "react"

import {EnhancedModal} from "@agenta/ui/components/modal"
import {Trash} from "@phosphor-icons/react"
import {useMutation} from "@tanstack/react-query"
import {Button, Input, Typography, message} from "antd"

import {useSession} from "@/oss/hooks/useSession"
import {deleteAccount} from "@/oss/services/profile"
import {useProfileData} from "@/oss/state/profile"

const DeleteAccount: React.FC = () => {
    const {user} = useProfileData()
    const {logout} = useSession()
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [confirmInput, setConfirmInput] = useState("")

    const email = user?.email ?? ""
    const isMatch = Boolean(email) && confirmInput.trim() === email

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

    const closeModal = () => {
        if (deleteMutation.isPending) return
        setIsModalOpen(false)
        setConfirmInput("")
    }

    return (
        // The shell caps the column; this page only owns its own vertical rhythm.
        <section className="flex flex-col gap-10">
            {/* Read-only: username is set at sign-up, email is the sign-in identity. */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                    <Typography.Text strong>Username</Typography.Text>
                    <Input value={user?.username ?? ""} readOnly className="max-w-[560px]" />
                    <Typography.Text type="secondary" className="text-xs">
                        How you appear in member lists and audit entries.
                    </Typography.Text>
                </div>

                <div className="flex flex-col gap-1.5">
                    <Typography.Text strong>Email</Typography.Text>
                    <Input value={email} readOnly className="max-w-[560px] font-mono" />
                    <Typography.Text type="secondary" className="text-xs">
                        Used for sign-in and for organization invitations.
                    </Typography.Text>
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <Typography.Title level={5} className="!mb-0">
                        Delete account
                    </Typography.Title>
                    <Typography.Text type="secondary">
                        Permanently delete your account and the organizations you own.
                    </Typography.Text>
                </div>

                <div className="rounded-lg border border-[var(--ant-color-error-border)] bg-[var(--ant-color-error-bg)] px-4 py-3 flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <Typography.Text strong className="!text-[var(--ant-color-error)]">
                            This action cannot be undone.
                        </Typography.Text>
                        <Typography.Paragraph className="!mb-0 text-[var(--ant-color-text)]">
                            Deletes your account, every organization you own, and all of their
                            workspaces, projects, applications, and data. You will be signed out
                            immediately.
                        </Typography.Paragraph>
                    </div>
                    <div>
                        <Button
                            danger
                            type="primary"
                            icon={<Trash size={14} />}
                            onClick={() => setIsModalOpen(true)}
                            disabled={!email}
                        >
                            Delete account
                        </Button>
                    </div>
                </div>
            </div>

            <EnhancedModal
                title="Delete account"
                open={isModalOpen}
                okText="Delete account"
                okType="danger"
                okButtonProps={{
                    icon: <Trash size={14} />,
                    type: "primary",
                    disabled: !isMatch,
                }}
                onCancel={closeModal}
                onOk={() => deleteMutation.mutate()}
                confirmLoading={deleteMutation.isPending}
                width={450}
            >
                <div className="flex flex-col gap-3">
                    <div className="rounded-lg border border-[var(--ant-color-error-border)] bg-[var(--ant-color-error-bg)] px-4 py-3">
                        <div className="flex flex-col gap-1">
                            <Typography.Text strong className="!text-[var(--ant-color-error)]">
                                This action cannot be undone.
                            </Typography.Text>
                            <Typography.Paragraph className="!mb-0 text-[var(--ant-color-text)]">
                                Permanently deletes your account and every organization you own,
                                including all workspaces, projects, applications, and data.
                            </Typography.Paragraph>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-[var(--ant-color-text)] flex-wrap">
                            <span>Type</span>
                            <Typography.Text
                                code
                                className="!text-[var(--ant-color-error)] !bg-[var(--ant-color-error-bg)] !border-[var(--ant-color-error-border)]"
                            >
                                {email}
                            </Typography.Text>
                            <span>to confirm:</span>
                        </div>
                        <Input
                            value={confirmInput}
                            onChange={(e) => setConfirmInput(e.target.value)}
                            placeholder="Your email"
                            autoComplete="off"
                            spellCheck={false}
                            status={confirmInput && !isMatch ? "error" : undefined}
                            autoFocus
                        />
                    </div>
                </div>
            </EnhancedModal>
        </section>
    )
}

export default DeleteAccount
