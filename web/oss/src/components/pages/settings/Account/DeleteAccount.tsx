import {useState} from "react"

import {Alert, AlertDescription, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Input} from "@agenta/primitive-ui/components/input"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {toast} from "@agenta/primitive-ui/lib/toast"
import {Trash} from "@phosphor-icons/react"
import {useMutation} from "@tanstack/react-query"

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
            toast.success("Your account has been deleted")
            // logout() signs out of SuperTokens, clears caches, and redirects.
            await logout()
        },
        onError: (error: any) => {
            toast.error(error?.message || "Unable to delete account")
        },
    })

    const closeModal = () => {
        if (deleteMutation.isPending) return
        setIsModalOpen(false)
        setConfirmInput("")
    }

    return (
        <section className="flex flex-col gap-4 max-w-[640px]">
            <div className="flex flex-col gap-1">
                <h5 className="text-base font-semibold">Delete account</h5>
                <span className="text-muted-foreground">
                    Permanently delete your account and the organizations you own. This cannot be
                    undone.
                </span>
            </div>

            <Alert variant="destructive">
                <AlertTitle>This action cannot be undone.</AlertTitle>
                <AlertDescription>
                    Deletes your account, every organization you own, and all of their workspaces,
                    projects, applications, and data. You will be signed out immediately.
                    <div className="mt-3">
                        <Button
                            variant="destructive"
                            onClick={() => setIsModalOpen(true)}
                            disabled={!email}
                        >
                            <Trash size={14} />
                            Delete account
                        </Button>
                    </div>
                </AlertDescription>
            </Alert>

            <Dialog
                open={isModalOpen}
                onOpenChange={(open) => {
                    if (!open) closeModal()
                }}
            >
                <DialogContent className="sm:max-w-[450px]">
                    <DialogHeader>
                        <DialogTitle>Delete account</DialogTitle>
                        <DialogDescription>
                            Permanently deletes your account and every organization you own,
                            including all workspaces, projects, applications, and data.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-3">
                        <Alert variant="destructive">
                            <AlertTitle>This action cannot be undone.</AlertTitle>
                        </Alert>

                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span>Type</span>
                                <code className="rounded border border-border bg-muted px-1.5 py-0.5 text-destructive text-sm">
                                    {email}
                                </code>
                                <span>to confirm:</span>
                            </div>
                            <Input
                                value={confirmInput}
                                onChange={(e) => setConfirmInput(e.target.value)}
                                placeholder="Your email"
                                autoComplete="off"
                                spellCheck={false}
                                aria-invalid={Boolean(confirmInput) && !isMatch}
                                autoFocus
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={closeModal}
                            disabled={deleteMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={!isMatch || deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate()}
                        >
                            {deleteMutation.isPending ? <Spinner /> : <Trash size={14} />}
                            Delete account
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    )
}

export default DeleteAccount
