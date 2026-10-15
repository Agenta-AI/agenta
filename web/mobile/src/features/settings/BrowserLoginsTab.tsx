import {useState} from "react"

import {
    archiveBrowserProfileAtom,
    browserProfilesQueryAtom,
    createBrowserProfileAtom,
    updateBrowserProfileAtom,
    type BrowserProfile,
    type BrowserProfileInput,
} from "@agenta/entities/browserProfile"
import {BrowserLoginDialog, messageOf, useBrowserLogin} from "@agenta/entity-ui/browser"
import {BrowserLoginsPage} from "@agenta/settings-ui"
import {Button} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {BrowserProfileFormDialog} from "./BrowserProfileFormDialog"
import {ConfirmModal} from "./ConfirmModal"

type ProfileDialog =
    | {kind: "create"}
    | {kind: "edit"; profile: BrowserProfile}
    | {kind: "delete"; profile: BrowserProfile}
    | null

export const BrowserLoginsTab = () => {
    const query = useAtomValue(browserProfilesQueryAtom)
    const createProfile = useSetAtom(createBrowserProfileAtom)
    const updateProfile = useSetAtom(updateBrowserProfileAtom)
    const archiveProfile = useSetAtom(archiveBrowserProfileAtom)
    const login = useBrowserLogin()
    const [dialog, setDialog] = useState<ProfileDialog>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const close = () => {
        setDialog(null)
        setError(null)
    }

    const run = async (work: () => Promise<unknown>, fallback: string) => {
        setPending(true)
        setError(null)
        try {
            await work()
            setDialog(null)
        } catch (cause) {
            setError(messageOf(cause, fallback))
        } finally {
            setPending(false)
        }
    }

    const submitForm = (input: BrowserProfileInput) => {
        if (dialog?.kind === "edit") {
            const profileId = dialog.profile.id
            void run(() => updateProfile({profileId, ...input}), "Could not save the login.")
        } else {
            void run(async () => {
                const profile = await createProfile(input)
                void login.open(profile)
            }, "Could not add the login.")
        }
    }

    return (
        <div className="flex flex-col gap-2">
            {query.isError ? (
                <div
                    role="alert"
                    className="flex items-center justify-between gap-2 rounded-md border border-solid border-border px-3 py-2 text-xs text-destructive"
                >
                    <span>Could not load your browser logins.</span>
                    <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                        Try again
                    </Button>
                </div>
            ) : null}
            <BrowserLoginsPage
                rows={query.data ?? []}
                loading={query.isPending}
                onCreate={() => setDialog({kind: "create"})}
                onLogin={(profile) => void login.open(profile)}
                onEditSites={(profile) => setDialog({kind: "edit", profile})}
                onDelete={(profile) => setDialog({kind: "delete", profile})}
            />

            <BrowserProfileFormDialog
                open={dialog?.kind === "create" || dialog?.kind === "edit"}
                profile={dialog?.kind === "edit" ? dialog.profile : null}
                pending={pending}
                error={error}
                onClose={close}
                onSubmit={submitForm}
            />

            <ConfirmModal
                open={dialog?.kind === "delete"}
                title="Delete browser login"
                description="This cannot be undone."
                body={
                    <>
                        Agents that use {dialog?.kind === "delete" ? dialog.profile.name : "it"}{" "}
                        lose their browser, and Agenta deletes the saved cookies.
                    </>
                }
                confirmLabel="Delete"
                pending={pending}
                error={error}
                onClose={close}
                onConfirm={() => {
                    if (dialog?.kind !== "delete") return
                    const profileId = dialog.profile.id
                    void run(() => archiveProfile(profileId), "Could not delete the login.")
                }}
            />

            <BrowserLoginDialog
                state={login.state}
                onDone={() => void login.finish()}
                onCancel={login.cancel}
            />
        </div>
    )
}
