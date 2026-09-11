import {useState} from "react"

import {deleteAccount} from "@agenta/entities/profile"
import {AccountPage} from "@agenta/settings-ui"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {useMutation} from "@tanstack/react-query"

import {useLogout} from "../auth/useLogout"

/**
 * Mobile binding: the shared account page, with this app's delete call and its confirm as a
 * modal — the same typed-email gate the desktop uses.
 */
export const AccountTab = ({
    user,
}: {
    user: {username?: string | null; email?: string | null} | null
}) => {
    const logout = useLogout()
    const [error, setError] = useState<string | null>(null)

    const deleteMutation = useMutation({
        mutationFn: deleteAccount,
        // The account is gone; signing out is what gets this device off screens whose data
        // no longer exists.
        onSuccess: () => logout(),
        onError: (cause: unknown) =>
            setError((cause as Error)?.message || "Unable to delete account"),
    })

    return (
        <AccountPage
            username={user?.username}
            email={user?.email}
            deleting={deleteMutation.isPending}
            onDeleteAccount={() => {
                setError(null)
                deleteMutation.mutate()
            }}
            renderConfirm={({open, onClose, onConfirm, confirmed, body}) => (
                <Dialog
                    open={open}
                    onOpenChange={(next) => {
                        if (!next) onClose()
                    }}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Delete account</DialogTitle>
                            <DialogDescription>This cannot be undone.</DialogDescription>
                        </DialogHeader>
                        <div className="m-0 text-sm">{body}</div>
                        {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={onClose}
                                disabled={deleteMutation.isPending}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                disabled={!confirmed || deleteMutation.isPending}
                                onClick={onConfirm}
                            >
                                {deleteMutation.isPending ? "Deleting…" : "Delete account"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        />
    )
}
