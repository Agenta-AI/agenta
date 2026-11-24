/**
 * "Attach a secret" as a modal, for the chat's secret request dock. The Agent tab opens the same
 * form as a view ({@link secretAttachView}); both read {@link useSecretAttachForm}.
 */
import type {AgentSecretBinding} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import secretAttachmentCatalog from "@agenta/i18n/catalogs/entityUi.secretAttachment"
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    LoadingButton,
} from "@agenta/ui/ui"

import type {AgentSecretRequestSeed} from "./agentSecretRules"
import {SecretAttachFields} from "./attach/SecretAttachFields"
import {useSecretAttachForm, type SecretAttachFormOptions} from "./attach/useSecretAttachForm"

export interface AgentSecretAttachmentTarget {
    revisionId: string
    label: string
}

export interface AgentSecretAttachmentResult {
    /** The `sandbox.credentials[]` entry the attach wrote. */
    credential: AgentSecretBinding
    revisionId: string
}

export interface AgentSecretAttachmentModalProps {
    open: boolean
    onClose: () => void
    target: AgentSecretAttachmentTarget
    request?: AgentSecretRequestSeed
    bindings: AgentSecretBinding[]
    baseRevisionId: string
    editingBinding?: {index: number; value: AgentSecretBinding}
    initialMode?: "existing" | "create"
    dirty?: boolean
    disabled?: boolean
    canCreateSecret?: boolean
    commitBinding: SecretAttachFormOptions["commitBinding"]
    onAttached?: (result: AgentSecretAttachmentResult) => void
    zIndex?: number
    /** A host panel (e.g. a drawer) to mask and centre within instead of the page. */
    container?: HTMLElement | null
}

export function AgentSecretAttachmentModal({
    open,
    onClose,
    target,
    request,
    bindings,
    baseRevisionId,
    editingBinding,
    initialMode,
    dirty = false,
    disabled = false,
    canCreateSecret,
    commitBinding,
    onAttached,
    zIndex = 1000,
    container,
}: AgentSecretAttachmentModalProps) {
    const t = useT(secretAttachmentCatalog)
    const tCommon = useT(commonCatalog)
    const form = useSecretAttachForm({
        open,
        revisionId: baseRevisionId,
        request,
        bindings,
        editingBinding,
        initialMode,
        dirty,
        disabled,
        canCreateSecret,
        commitBinding,
        onAttached,
    })
    const title = editingBinding
        ? t("entityUi.secretAttachment.editTitle")
        : t("entityUi.secretAttachment.attachTitle")

    return (
        // Contained runs non-modal: the host drawer already traps focus.
        <Dialog open={open} onOpenChange={(next) => !next && onClose()} modal={!container}>
            <DialogContent
                container={container ?? undefined}
                contained={!!container}
                className="max-w-[480px]"
                style={{zIndex}}
            >
                <DialogHeader>
                    <DialogTitle>
                        <span className="flex min-w-0 items-baseline gap-2">
                            <span className="shrink-0">{title}</span>
                            <span className="min-w-0 truncate text-meta font-normal text-muted-foreground">
                                · {target.label}
                            </span>
                        </span>
                    </DialogTitle>
                </DialogHeader>
                <SecretAttachFields
                    form={form}
                    request={request}
                    agentDirty={dirty}
                    container={container}
                    // The shared Select portals its list to <body> at z-50; one layer above the modal
                    // keeps the options over it (#6733).
                    popupZIndex={zIndex + 1}
                />
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>
                        {tCommon("common.cancel")}
                    </Button>
                    <LoadingButton
                        loading={form.submitting}
                        disabled={!form.canSubmit}
                        onClick={() =>
                            void form.submit().then((attached) => {
                                if (attached) onClose()
                            })
                        }
                    >
                        {form.submitLabel}
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
