import {useState} from "react"

import {deleteAccount} from "@agenta/entities/profile"
import {AccountPage} from "@agenta/settings-ui"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {useMutation} from "@tanstack/react-query"

import {useLogout} from "../auth/useLogout"

/**
 * Mobile binding: the shared account page, with this app's delete call and its confirm as an
 * alert dialog — the same typed-email gate the desktop uses.
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
                <AlertDialog
                    open={open}
                    onOpenChange={(next) => {
                        if (!next && !deleteMutation.isPending) onClose()
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete account</AlertDialogTitle>
                            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="m-0 text-sm">{body}</div>
                        {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                        <AlertDialogFooter>
                            <AlertDialogCancel asChild>
                                <Button
                                    variant="outline"
                                    onClick={onClose}
                                    disabled={deleteMutation.isPending}
                                >
                                    Cancel
                                </Button>
                            </AlertDialogCancel>
                            {/* Stays open for the error; success signs out, which unmounts it. */}
                            <AlertDialogAction asChild>
                                <Button
                                    variant="destructive"
                                    disabled={!confirmed || deleteMutation.isPending}
                                    onClick={(event) => {
                                        event.preventDefault()
                                        onConfirm()
                                    }}
                                >
                                    {deleteMutation.isPending ? "Deleting…" : "Delete account"}
                                </Button>
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        />
    )
}
