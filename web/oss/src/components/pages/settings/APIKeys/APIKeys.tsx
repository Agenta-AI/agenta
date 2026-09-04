import {useCallback, useState} from "react"

import {useApiKeys} from "@agenta/settings"
import {ApiKeysPage} from "@agenta/settings-ui"
import {EnhancedModal} from "@agenta/ui/components/modal"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {useOrgData} from "@/oss/state/org"

/** OSS binding: the shared keys table, with this app's confirm and one-time reveal. */
const APIKeys = () => {
    const {canEditApiKeys, canViewApiKeys} = useProjectPermissions()
    const {selectedOrg} = useOrgData()
    const [workspacePending, setWorkspacePending] = useState(false)

    const confirmDelete = useCallback(
        () =>
            new Promise<boolean>((resolve) => {
                AlertPopup({
                    title: "Delete API Key",
                    message:
                        "Are you sure you want to delete this API Key? This action is irreversible!",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                })
            }),
        [],
    )

    const onCreated = useCallback((secret: string) => {
        AlertPopup({
            width: 520,
            type: "success",
            title: "API key created",
            message: (
                <div className="flex flex-col gap-3">
                    <div>Copy this key now — it is shown once and cannot be retrieved again.</div>
                    <div className="rounded-md border border-solid border-colorBorder bg-colorFillQuaternary px-3 py-2 font-mono text-xs break-all">
                        {secret}
                    </div>
                </div>
            ),
            cancelText: null,
            okText: "Copy & close",
            // The key is unrecoverable once dismissed, so OK copies it.
            onOk: () => copyToClipboard(secret),
        })
    }, [])

    const keys = useApiKeys({
        workspaceId: selectedOrg?.default_workspace?.id || "",
        canView: canViewApiKeys,
        canEdit: canEditApiKeys,
        confirmDelete,
        onCreated,
        onWorkspacePending: () => setWorkspacePending(true),
    })

    return (
        <div className="flex flex-col gap-2">
            <ApiKeysPage
                rows={keys.keys}
                listing={keys.listing}
                creating={keys.creating}
                canView={canViewApiKeys}
                canEdit={canEditApiKeys}
                onReload={keys.list}
                onCreate={() => void keys.create()}
                onDelete={(prefix) => void keys.remove(prefix)}
            />

            <EnhancedModal
                title="Workspace still loading"
                open={workspacePending}
                onOk={() => setWorkspacePending(false)}
                onCancel={() => setWorkspacePending(false)}
            >
                <p>Your workspace is still loading. Try again in a moment.</p>
            </EnhancedModal>
        </div>
    )
}

export default APIKeys
