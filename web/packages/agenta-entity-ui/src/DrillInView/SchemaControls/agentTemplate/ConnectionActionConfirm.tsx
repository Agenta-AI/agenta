/** Confirms a destructive connection verb (revoke, delete) inside the integration drawer. */
import {useState} from "react"

import {useT, type CatalogKey} from "@agenta/i18n"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    LoadingButton,
} from "@agenta/ui/ui"

export type ConnectionAction = "revoke" | "delete"

// Settings' own wording, so the same verb reads the same in both places.
type IntegrationDrawerKey = CatalogKey<typeof integrationDrawerCatalog>

const COPY: Record<
    ConnectionAction,
    {
        title: IntegrationDrawerKey
        body: IntegrationDrawerKey
        confirm: IntegrationDrawerKey
        failed: IntegrationDrawerKey
    }
> = {
    revoke: {
        title: "entityUi.integrationDrawer.revokeTitle",
        body: "entityUi.integrationDrawer.revokeBody",
        confirm: "entityUi.integrationDrawer.revoke",
        failed: "entityUi.integrationDrawer.revokeFailed",
    },
    delete: {
        title: "entityUi.integrationDrawer.deleteTitle",
        body: "entityUi.integrationDrawer.deleteBody",
        confirm: "entityUi.integrationDrawer.delete",
        failed: "entityUi.integrationDrawer.deleteFailed",
    },
}

export function ConnectionActionConfirm({
    action,
    name,
    container,
    onConfirm,
    onClose,
}: {
    action: ConnectionAction
    name: string
    /** The drawer panel: the dialog masks and centres inside it, not the page. */
    container: HTMLElement | null
    onConfirm: () => Promise<void>
    onClose: () => void
}) {
    const t = useT(integrationDrawerCatalog)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const copy = COPY[action]

    return (
        // Non-modal when contained: the drawer already traps focus.
        <Dialog modal={!container} open onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent
                container={container ?? undefined}
                contained={!!container}
                showCloseButton={false}
                className="max-w-[400px]"
            >
                <DialogHeader>
                    <DialogTitle>{t(copy.title, {name})}</DialogTitle>
                    <DialogDescription>{t(copy.body)}</DialogDescription>
                </DialogHeader>
                {error ? (
                    <p role="alert" className="m-0 text-sm text-colorError">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t("entityUi.integrationDrawer.cancel")}
                    </Button>
                    <LoadingButton
                        variant="destructive"
                        loading={working}
                        onClick={async () => {
                            setWorking(true)
                            setError(null)
                            try {
                                await onConfirm()
                                onClose()
                            } catch (cause) {
                                // Stays open with the reason, so the user knows nothing changed.
                                setError((cause as Error)?.message || t(copy.failed))
                            } finally {
                                setWorking(false)
                            }
                        }}
                    >
                        {t(copy.confirm)}
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
