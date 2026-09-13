import {useCallback, useState} from "react"

import {useApiKeys} from "@agenta/settings"
import {ApiKeysPage} from "@agenta/settings-ui"

import {Button} from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

import {useProjectPermission} from "../context/useProjectPermission"

import {ConfirmModal} from "./ConfirmModal"

/**
 * Mobile binding: the shared keys table with this app's delete confirm and the one-time reveal
 * of a new key. The desktop binding is `oss/.../settings/APIKeys/APIKeys.tsx`.
 *
 * The edit gate is the effective `edit_api_keys` permission read from the backend — the same
 * action the desktop's role table resolves — rather than an optimistic flag, because a key is a
 * credential and the buttons should not appear for a member who cannot mint one.
 */
export const ApiKeysTab = ({
    workspaceId,
    projectId,
    canView,
}: {
    workspaceId: string
    projectId: string
    canView: boolean
}) => {
    const canEdit = useProjectPermission(projectId, "edit_api_keys")
    const [pendingDelete, setPendingDelete] = useState<{resolve: (ok: boolean) => void} | null>(
        null,
    )
    const [createdKey, setCreatedKey] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const confirmDelete = useCallback(
        () => new Promise<boolean>((resolve) => setPendingDelete({resolve})),
        [],
    )
    const answerDelete = useCallback(
        (ok: boolean) => {
            pendingDelete?.resolve(ok)
            setPendingDelete(null)
        },
        [pendingDelete],
    )

    const keys = useApiKeys({
        workspaceId,
        canView,
        canEdit,
        confirmDelete,
        onCreated: (secret) => {
            setError(null)
            setCreatedKey(secret)
        },
        onWorkspacePending: () =>
            setError("Your workspace is still loading. Try again in a moment."),
        onError: (verb, cause) =>
            setError(
                (cause as Error)?.message ||
                    (verb === "create" ? "Could not create the key" : "Could not delete the key"),
            ),
    })

    const closeReveal = () => {
        setCreatedKey(null)
        setCopied(false)
        setCopyError(null)
    }

    return (
        <div className="flex flex-col gap-2">
            {error ? (
                <p role="alert" className="text-destructive m-0 text-xs">
                    {error}
                </p>
            ) : null}
            <ApiKeysPage
                rows={keys.keys}
                listing={keys.listing}
                creating={keys.creating}
                canView={canView}
                canEdit={canEdit}
                onReload={keys.list}
                onCreate={() => {
                    setError(null)
                    void keys.create()
                }}
                onDelete={(prefix) => {
                    setError(null)
                    void keys.remove(prefix)
                }}
            />

            <ConfirmModal
                open={Boolean(pendingDelete)}
                title="Delete API key"
                description="This cannot be undone."
                body="Requests signed with this key stop working immediately."
                confirmLabel="Delete"
                pending={keys.deleting}
                onClose={() => answerDelete(false)}
                onConfirm={() => answerDelete(true)}
            />

            <Sheet
                open={Boolean(createdKey)}
                onOpenChange={(next) => {
                    if (!next) closeReveal()
                }}
            >
                <SheetContent side="responsive">
                    <SheetHeader>
                        <SheetTitle>Save your API key</SheetTitle>
                        <SheetDescription>
                            Shown once. It cannot be retrieved again after you close this.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="px-4">
                        <p className="m-0 break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
                            {createdKey}
                        </p>
                    </div>
                    {copyError ? (
                        <p role="alert" className="text-destructive m-0 px-4 pt-2 text-xs">
                            {copyError}
                        </p>
                    ) : null}
                    <SheetFooter>
                        <Button
                            onClick={async () => {
                                if (!createdKey) return
                                // `navigator.clipboard` is undefined outside a secure context;
                                // an optional chain would report success on a key shown once.
                                try {
                                    await navigator.clipboard.writeText(createdKey)
                                    setCopyError(null)
                                    setCopied(true)
                                } catch {
                                    setCopyError("Couldn't copy — select the key above and copy it")
                                }
                            }}
                        >
                            {copied ? "Copied" : "Copy key"}
                        </Button>
                        <Button variant="outline" onClick={closeReveal}>
                            Done
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </div>
    )
}
