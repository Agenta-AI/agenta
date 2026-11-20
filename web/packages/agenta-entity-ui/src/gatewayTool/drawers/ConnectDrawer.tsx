import {useCallback} from "react"

import {useT} from "@agenta/i18n"
import connectFormCatalog from "@agenta/i18n/catalogs/entityUi.connectForm"
import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"

import {
    ConnectAppMark,
    ConnectFormFields,
    useConnectForm,
    type ConnectionOwner,
} from "../components/ConnectForm"

interface Props {
    open: boolean
    integrationKey: string
    integrationName: string
    integrationLogo?: string
    integrationDescription?: string
    authSchemes: string[]
    onClose: () => void
    /** The connection is made; `owner` is who it belongs to. */
    onSuccess?: (owner: ConnectionOwner) => void
    /** A drawer panel to open inside, masking only that drawer. Absent = the page. */
    container?: HTMLElement | null
    /**
     * Who may own the new connection; the first is the default. Two ask "Who can use it", one
     * is used without asking. Absent, the connection is the project's.
     */
    owners?: ConnectionOwner[]
    /** The current project's name, for "Everyone in {project}". */
    projectName?: string
}

/** The connect form in a dialog, for the hosts that keep a dialog. */
export default function ConnectDrawer({
    open,
    integrationName,
    integrationLogo,
    onClose,
    container = null,
    ...body
}: Props) {
    return (
        <EnhancedModal
            open={open}
            onCancel={onClose}
            // The integration's mark heads the dialog, beside the close button.
            title={<ConnectAppMark name={integrationName} logo={integrationLogo} />}
            footer={null}
            width={480}
            // The form mounts per open, so a reopened dialog starts from its defaults.
            destroyOnClose
            getContainer={container ?? false}
            contained={!!container}
        >
            <ConnectDialogBody integrationName={integrationName} onClose={onClose} {...body} />
        </EnhancedModal>
    )
}

function ConnectDialogBody({
    integrationKey,
    integrationName,
    integrationDescription,
    authSchemes,
    owners,
    projectName,
    onClose,
    onSuccess,
}: Omit<Props, "open" | "integrationLogo" | "container">) {
    const t = useT(connectFormCatalog)
    const form = useConnectForm({integrationKey, integrationName, authSchemes, owners})
    const {submit, owner} = form
    const handleSubmit = useCallback(async () => {
        if (!(await submit())) return
        onClose()
        onSuccess?.(owner)
    }, [submit, owner, onClose, onSuccess])
    return (
        <ModalContent>
            <ConnectFormFields
                form={form}
                integrationName={integrationName}
                integrationDescription={integrationDescription}
                projectName={projectName}
            />
            <ModalFooter
                onCancel={onClose}
                onConfirm={handleSubmit}
                confirmLabel={t("entityUi.connectForm.connect")}
                isLoading={form.loading}
            />
        </ModalContent>
    )
}
