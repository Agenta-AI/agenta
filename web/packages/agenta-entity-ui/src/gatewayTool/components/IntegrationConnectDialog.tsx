import {useEffect, useState, type ReactNode} from "react"

import {toolIntegrationDetailQueryFamily} from "@agenta/entities/gatewayTool"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import connectFormCatalog from "@agenta/i18n/catalogs/entityUi.connectForm"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {BottomSheet, PHONE_BUTTON_CLASS, useIsPhone} from "@agenta/ui/phone"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import type {ConnectionOwner} from "../../accounts/ConnectOwnerField"
import {useProjectName} from "../../accounts/useProjectName"

import {ConnectAppMark, ConnectFormFields, useConnectForm} from "./ConnectForm"

export interface IntegrationConnectDialogProps {
    /** The app to connect. */
    integrationKey: string
    /** Who may own the new connection; the first is the default. Two ask for the Owner. */
    owners?: ConnectionOwner[]
    /** The dialog has closed: the host drops it. */
    onClosed: () => void
}

/** The form's outline while the app's sign-in methods load, at the form's own heights. */
const FieldsSkeleton = ({askOwner}: {askOwner: boolean}) => (
    <div aria-busy className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
            <span className="flex h-4 items-center">
                <SkeletonBlock className="h-2.5 w-12" />
            </span>
            <SkeletonBlock shape="soft" className="h-control" />
        </div>
        {askOwner ? (
            <div className="flex flex-col gap-1">
                <span className="flex h-[18px] items-center">
                    <SkeletonBlock className="h-3 w-14" />
                </span>
                <SkeletonBlock shape="soft" className="h-[76px]" />
            </div>
        ) : null}
    </div>
)

/** The fields and the Connect action once the app's sign-in methods are known. */
const LoadedBody = ({
    integrationKey,
    name,
    authSchemes,
    owners,
    onDone,
    onBusyChange,
    actions,
}: {
    integrationKey: string
    name: string
    authSchemes: string[]
    owners?: ConnectionOwner[]
    onDone: () => void
    /** A connect step is running: the host holds its close until it ends. */
    onBusyChange: (busy: boolean) => void
    actions: (connect: {run: () => void; busy: boolean; valid: boolean}) => ReactNode
}) => {
    const form = useConnectForm({integrationKey, integrationName: name, authSchemes, owners})
    const projectName = useProjectName(Boolean(owners && owners.length > 1))
    useEffect(() => onBusyChange(form.loading), [form.loading, onBusyChange])
    return (
        <>
            <div className="flex flex-col gap-4 ph-no-capture">
                <ConnectFormFields
                    form={form}
                    integrationName={name}
                    projectName={projectName}
                    hideHeading
                />
            </div>
            {actions({
                run: () => {
                    void form.submit().then((made) => {
                        if (made) onDone()
                    })
                },
                busy: form.loading,
                valid: form.valid,
            })}
        </>
    )
}

/** Connect an app in a dialog, or a bottom sheet on a phone. */
export const IntegrationConnectDialog = ({
    integrationKey,
    owners,
    onClosed,
}: IntegrationConnectDialogProps) => {
    const t = useT(commonCatalog, connectFormCatalog, integrationViewsCatalog)
    const phone = useIsPhone()
    const [open, setOpen] = useState(true)
    const [busy, setBusy] = useState(false)
    const close = () => setOpen(false)
    const query = useAtomValue(toolIntegrationDetailQueryFamily(integrationKey))
    const integration = query.data?.integration ?? null
    const name = integration?.name ?? integrationKey
    const askOwner = Boolean(owners && owners.length > 1)

    // Cancel and Connect: a row in the dialog's footer, stacked under the fields on a phone.
    const actions = (connect?: {run: () => void; busy: boolean; valid: boolean}) => {
        const connectButton = (
            <Button
                className={phone ? PHONE_BUTTON_CLASS : undefined}
                disabled={!connect || !connect.valid || connect.busy}
                onClick={connect?.run}
            >
                {t("entityUi.connectForm.connect")}
            </Button>
        )
        if (phone) return <div className="mt-4 flex flex-col">{connectButton}</div>
        return (
            <DialogFooter>
                <Button variant="outline" disabled={connect?.busy} onClick={close}>
                    {t("common.cancel")}
                </Button>
                {connectButton}
            </DialogFooter>
        )
    }

    const content =
        !integration && query.isError ? (
            <>
                <div className="flex flex-col items-start gap-3 text-label">
                    <span className="text-muted-foreground">
                        {t("entityUi.integrationViews.appLoadError")}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                        {t("entityUi.integrationViews.tryAgain")}
                    </Button>
                </div>
                {actions()}
            </>
        ) : !integration ? (
            <>
                <FieldsSkeleton askOwner={askOwner} />
                {actions()}
            </>
        ) : (
            <LoadedBody
                integrationKey={integrationKey}
                name={integration.name ?? integrationKey}
                authSchemes={(integration.auth_schemes as string[] | null | undefined) ?? []}
                owners={owners}
                onDone={close}
                onBusyChange={setBusy}
                actions={actions}
            />
        )

    if (phone) {
        return (
            <BottomSheet
                open={open}
                onOpenChange={(next) => (next || busy ? undefined : close())}
                title={t("entityUi.connectForm.connectName", {name})}
                showTitle
                onCloseAutoFocus={onClosed}
            >
                <div className="px-4">{content}</div>
            </BottomSheet>
        )
    }
    return (
        <Dialog open={open} onOpenChange={(next) => (next || busy ? undefined : close())}>
            <DialogContent onCloseAutoFocus={onClosed}>
                <DialogHeader>
                    {integration ? (
                        <ConnectAppMark name={name} logo={integration.logo} />
                    ) : (
                        <SkeletonBlock shape="mark" className="size-8" />
                    )}
                    <DialogTitle>{t("entityUi.connectForm.connectName", {name})}</DialogTitle>
                    {integration?.description ? (
                        <DialogDescription className="truncate" title={integration.description}>
                            {integration.description}
                        </DialogDescription>
                    ) : !integration ? (
                        // The description's line while it loads, so the header keeps its height.
                        <span className="flex h-5 items-center">
                            <SkeletonBlock className="h-3 w-3/4" />
                        </span>
                    ) : null}
                </DialogHeader>
                {content}
            </DialogContent>
        </Dialog>
    )
}
