/** The agent's custom secrets (`sandbox.credentials`), shown inside the Advanced section. */
import {useState} from "react"

import type {AgentSecretBinding} from "@agenta/entities/secret"

import {AgentSecretsSection} from "../AgentSecretsSection"

import type {ModelHarnessT} from "./types"

export interface SecretsSectionParams {
    t: ModelHarnessT
    sandbox: Record<string, unknown>
    revisionId?: string | null
    disabled?: boolean
    credentialOperationsBlocked: boolean
    canEditSecrets: boolean
    onRevisionCommitted: (nextRevisionId: string) => void
}

export const useSecretsSection = ({
    t,
    sandbox,
    revisionId,
    disabled,
    credentialOperationsBlocked,
    canEditSecrets,
    onRevisionCommitted,
}: SecretsSectionParams) => {
    const secretBindings = Array.isArray(sandbox.credentials)
        ? sandbox.credentials.filter((value): value is AgentSecretBinding => {
              if (!value || typeof value !== "object") return false
              const candidate = value as AgentSecretBinding
              return (
                  (typeof candidate.secret?.slug === "string" ||
                      candidate.secret?.account_source === "user") &&
                  candidate.binding?.type === "env" &&
                  typeof candidate.binding.name === "string"
              )
          })
        : []

    // The Attach button sits in the panel header; the section portals it into this slot.
    const [secretsHeaderSlot, setSecretsHeaderSlot] = useState<HTMLElement | null>(null)
    const secretsBody = (
        <AgentSecretsSection
            revisionId={revisionId}
            bindings={secretBindings}
            disabled={disabled}
            localDraftDirty={credentialOperationsBlocked}
            canEditSecrets={canEditSecrets}
            onRevisionCommitted={onRevisionCommitted}
            attachContainer={secretsHeaderSlot}
        />
    )

    const secretsSummary = secretBindings.length
        ? t("entityUi.modelHarness.attachedCount", {count: secretBindings.length})
        : t("entityUi.modelHarness.noneAttached")

    return {secretBindings, secretsBody, secretsSummary, setSecretsHeaderSlot}
}
