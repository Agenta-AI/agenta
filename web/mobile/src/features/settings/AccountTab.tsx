import {useState} from "react"

import {deleteAccount} from "@agenta/entities/profile"
import {AccountPage} from "@agenta/settings-ui"
import {useMutation} from "@tanstack/react-query"

import {Button} from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

import {useLogout} from "../auth/useLogout"

/**
 * Mobile binding: the shared account page, with this app's delete call and its confirm as a
 * bottom sheet (the desktop uses a modal — same typed-email gate, each app's own idiom).
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
                <Sheet
                    open={open}
                    onOpenChange={(next) => {
                        if (!next) onClose()
                    }}
                >
                    <SheetContent
                        side="bottom"
                        className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-2xl"
                    >
                        <SheetHeader>
                            <SheetTitle>Delete account</SheetTitle>
                            <SheetDescription>This cannot be undone.</SheetDescription>
                        </SheetHeader>
                        <div className="px-4 text-sm">{body}</div>
                        {error ? (
                            <p className="px-4 pt-3 text-sm text-colorError">{error}</p>
                        ) : null}
                        <SheetFooter>
                            <Button
                                variant="destructive"
                                disabled={!confirmed || deleteMutation.isPending}
                                onClick={onConfirm}
                            >
                                {deleteMutation.isPending ? "Deleting…" : "Delete account"}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={onClose}
                                disabled={deleteMutation.isPending}
                            >
                                Cancel
                            </Button>
                        </SheetFooter>
                    </SheetContent>
                </Sheet>
            )}
        />
    )
}
