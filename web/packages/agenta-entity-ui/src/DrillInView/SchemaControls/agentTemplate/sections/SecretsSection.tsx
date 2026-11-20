/**
 * Secrets (F04 f3): the agent's secret attachments (`sandbox.credentials`), a section of its own
 * after Skills. A row shows the environment variable over the secret it reads; a click opens
 * "Attach a secret" to edit it; the bin asks first (F06 f3). Each attach, edit and remove saves a
 * new agent version at once, as production does.
 */
import {useMemo, useState} from "react"

import {
    CustomSecretFormat,
    isUserSecretBinding,
    useVaultSecret,
    type AgentSecretBinding,
} from "@agenta/entities/secret"
import {
    agentRequirementsAtomFamily,
    commitAgentCredentialsAtom,
    requirementForItem,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {createT, useT} from "@agenta/i18n"
import agentSecretsCatalog from "@agenta/i18n/catalogs/entityUi.agentSecrets"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import secretAttachmentCatalog from "@agenta/i18n/catalogs/entityUi.secretAttachment"
import secretViewsCatalog from "@agenta/i18n/catalogs/entityUi.secretViews"
import {Spinner} from "@agenta/ui/ui"
import {Key, Vault} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {ACCOUNT_COPY} from "../../../../accounts/copy"
import {SecretRemoveDialog} from "../../../../secret/SecretRemoveDialog"
import {ItemRow, type ItemRowStatus} from "../ItemRow"
import {needsSetupLabel, needsSetupReasonText} from "../needsSetupText"
import {SectionAddButton} from "../SectionAddButton"

import type {SectionIndicatorFor, SectionResult} from "./types"

const tNow = createT(secretViewsCatalog, modelHarnessCatalog, secretAttachmentCatalog)

export interface SecretsSectionParams {
    sectionIndicator: SectionIndicatorFor
    bindings: AgentSecretBinding[]
    revisionId: string | null
    disabled?: boolean
    canEditSecrets: boolean
    /** Opens "Attach a secret": a new attachment, or the one of `envVar`. */
    openAttach: (envVar?: string) => void
    onRevisionCommitted?: (revisionId: string) => void
}

export const secretsSection = ({
    sectionIndicator,
    bindings,
    revisionId,
    disabled,
    canEditSecrets,
    openAttach,
    onRevisionCommitted,
}: SecretsSectionParams): SectionResult =>
    Boolean(revisionId) && {
        key: "secrets",
        icon: <Vault size={16} />,
        title: tNow("entityUi.secretViews.secrets"),
        summary: bindings.length
            ? tNow("entityUi.modelHarness.attachedCount", {count: bindings.length})
            : tNow("entityUi.modelHarness.noneAttached"),
        indicator: sectionIndicator("secrets"),
        extra: !disabled ? (
            <SecretsAddButton
                revisionId={revisionId ?? ""}
                canEditSecrets={canEditSecrets}
                onAdd={() => openAttach()}
            />
        ) : undefined,
        defaultOpen: bindings.length > 0,
        content: (
            <SecretsSectionBody
                revisionId={revisionId ?? ""}
                bindings={bindings}
                disabled={disabled}
                canEditSecrets={canEditSecrets}
                openAttach={openAttach}
                onRevisionCommitted={onRevisionCommitted}
            />
        ),
    }

/** A saved revision with no change waiting: the production rule for attach and remove. */
const useCanChange = (revisionId: string, canEditSecrets: boolean, disabled?: boolean) => {
    const dirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId))
    const committed = Boolean(revisionId) && !revisionId.startsWith("local-")
    return {dirty, committed, canChange: committed && !disabled && canEditSecrets && !dirty}
}

const SecretsAddButton = ({
    revisionId,
    canEditSecrets,
    onAdd,
}: {
    revisionId: string
    canEditSecrets: boolean
    onAdd: () => void
}) => {
    const t = useT(secretAttachmentCatalog)
    const {canChange} = useCanChange(revisionId, canEditSecrets)
    return (
        <SectionAddButton
            label={t("entityUi.secretAttachment.attachTitle")}
            disabled={!canChange}
            onClick={(event) => {
                // The button sits in the section header, which toggles on click.
                event.stopPropagation()
                onAdd()
            }}
        />
    )
}

export const SecretsSectionBody = ({
    revisionId,
    bindings,
    disabled,
    canEditSecrets,
    openAttach,
    onRevisionCommitted,
}: {
    revisionId: string
    bindings: AgentSecretBinding[]
    disabled?: boolean
    canEditSecrets: boolean
    openAttach: (envVar?: string) => void
    onRevisionCommitted?: (revisionId: string) => void
}) => {
    const t = useT(agentSecretsCatalog)
    const {namedSecrets, loading} = useVaultSecret()
    const requirements = useAtomValue(agentRequirementsAtomFamily(revisionId))
    const commit = useSetAtom(commitAgentCredentialsAtom)
    const {dirty, committed, canChange} = useCanChange(revisionId, canEditSecrets, disabled)
    // The row the dialog is for, by its variable: a commit elsewhere can reorder the list.
    const [removing, setRemoving] = useState<string | null>(null)

    const namesBySlug = useMemo(
        () =>
            new Map(
                namedSecrets
                    .filter((secret) => secret.format === CustomSecretFormat.Text)
                    .map((secret) => [secret.slug, secret.name]),
            ),
        [namedSecrets],
    )

    // The agent can change while the dialog is open (a builder edit); the dialog then says why.
    const remove = async () => {
        if (removing === null) return
        if (!committed) throw new Error(t("entityUi.agentSecrets.saveAgentFirst"))
        if (dirty) throw new Error(t("entityUi.agentSecrets.saveOrDiscardFirst"))
        const result = await commit({
            revisionId,
            bindings: bindings.filter((binding) => binding.binding.name !== removing),
        })
        onRevisionCommitted?.(result.revisionId)
        setRemoving(null)
    }

    const notice = !canEditSecrets
        ? t("entityUi.agentSecrets.needPermission")
        : !committed
          ? t("entityUi.agentSecrets.saveAgentFirst")
          : dirty
            ? t("entityUi.agentSecrets.saveOrDiscardBeforeChanging")
            : null

    return (
        <div className="flex flex-col gap-2">
            {notice ? (
                <div className="rounded-lg border border-colorBorderSecondary p-3 text-xs text-colorTextSecondary">
                    {notice}
                </div>
            ) : null}
            {loading ? (
                <div className="flex items-center gap-2 py-3 text-xs text-colorTextSecondary">
                    <Spinner size="small" /> {t("entityUi.agentSecrets.loadingSecrets")}
                </div>
            ) : bindings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-colorBorderSecondary p-4 text-center text-xs text-colorTextSecondary">
                    {t("entityUi.agentSecrets.noSecretsAttached")}
                </div>
            ) : (
                bindings.map((binding) => {
                    const envVar = binding.binding.name
                    const secretName = isUserSecretBinding(binding)
                        ? ACCOUNT_COPY.userSecretRow
                        : (namesBySlug.get(binding.secret.slug ?? "") ?? binding.secret.slug ?? "")
                    const requirement = requirements
                        ? requirementForItem(requirements, {
                              kinds: ["secret"],
                              slug: binding.secret.slug,
                          })
                        : undefined
                    const status: ItemRowStatus | undefined = requirement
                        ? {
                              tone: "incomplete",
                              label: needsSetupLabel(),
                              reason: needsSetupReasonText(requirement.reason) ?? undefined,
                              needsSetup: true,
                          }
                        : undefined
                    return (
                        // The row cuts long text at the end; the full text shows on hover.
                        <div
                            key={`${binding.secret.slug ?? "user"}-${envVar}`}
                            title={`${envVar}\n${secretName}`}
                        >
                            <ItemRow
                                descriptor={{
                                    name: envVar,
                                    description: secretName,
                                    mono: "",
                                    color: "",
                                    icon: <Key size={14} />,
                                    avatarClassName:
                                        "bg-colorFillSecondary text-colorTextSecondary",
                                    tags: [],
                                    typeLabel: "",
                                    subtitle: "",
                                }}
                                status={status}
                                disabled={!canChange}
                                onEdit={() => openAttach(envVar)}
                                onRemove={() => setRemoving(envVar)}
                            />
                        </div>
                    )
                })
            )}
            {removing !== null ? (
                <SecretRemoveDialog onRemove={remove} onClose={() => setRemoving(null)} />
            ) : null}
        </div>
    )
}
