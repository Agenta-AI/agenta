import {useState} from "react"

import {
    CustomSecretFormat,
    personalNamedSecretsAtom,
    useVaultSecret,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import secretFormSheetCatalog from "@agenta/i18n/catalogs/settings.secretFormSheet"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"

import {OwnerField} from "../accounts/OwnerField"
import {useProjectName} from "../accounts/useProjectName"

import type {SecretOwner} from "./agentSecretRules"
import {SecretForm, useSecretForm, type SecretFormController} from "./SecretForm"
import {objectToRows, type KvRow} from "./SecretForm/primitives"

/** Grid rows as the person sees them; a row with a value and no key yet still counts. */
const filledRows = (rows: KvRow[]) => rows.filter((row) => row.key.trim() || row.value !== "")

/** The form differs from the secret it opened with (or, for a new one, holds any value). */
export const secretFormDirty = (
    form: Pick<
        SecretFormController,
        "name" | "textValue" | "defaultEnvVar" | "kvRows" | "jsonView" | "jsonText" | "format"
    >,
    secret: NamedSecretRow | null,
): boolean => {
    const savedJson =
        secret?.format === CustomSecretFormat.Json &&
        secret.content &&
        typeof secret.content === "object"
            ? secret.content
            : {}
    // The JSON editor's text when it is open; text that does not parse is an edit too.
    const jsonChanged = () => {
        if (form.jsonView === "grid")
            return !deepEqual(filledRows(form.kvRows), filledRows(objectToRows(savedJson)))
        try {
            return !deepEqual(JSON.parse(form.jsonText), savedJson)
        } catch {
            return true
        }
    }
    if (!secret) return Boolean(form.name.trim() || form.textValue.trim()) || jsonChanged()
    if (
        form.name !== (secret.name ?? "") ||
        form.format !== secret.format ||
        form.defaultEnvVar !== (secret.defaultEnvVar ?? "")
    )
        return true
    if (form.format === CustomSecretFormat.Text)
        return form.textValue !== (typeof secret.content === "string" ? secret.content : "")
    return jsonChanged()
}

export interface SecretFormSetupParams {
    /** The secret to edit; absent creates one. */
    secretId?: string
    /** The owners a new secret may take, narrowest first; more than one asks for the Owner. */
    owners?: readonly SecretOwner[]
}

/** The secret form's state for any host: the secret, its owner, the form, and how to save it. */
export const useSecretFormSetup = (params: SecretFormSetupParams) => {
    const t = useT(secretFormSheetCatalog)
    const {namedSecrets} = useVaultSecret()
    const ownSecrets = useAtomValue(personalNamedSecretsAtom)
    // Read once: a refetch while the form is open must not swap the row under the person.
    const [secret] = useState<NamedSecretRow | null>(
        () =>
            (params.secretId
                ? [...namedSecrets, ...ownSecrets].find((row) => row.id === params.secretId)
                : undefined) ?? null,
    )
    const owners = params.owners
    const [chosenOwner, setOwner] = useState<SecretOwner>(owners?.[0] ?? "project")
    // An edit keeps the row's owner; a new secret takes the chosen one.
    const owner = owners?.includes(chosenOwner) ? chosenOwner : (owners?.[0] ?? "project")
    const askOwner = !secret && (owners?.length ?? 0) > 1
    const projectName = useProjectName(askOwner)
    const controller = useSecretForm({
        open: true,
        initialSecret: secret,
        ownerKind: (secret ? secret.ownerKind : owner) === "user" ? "user" : undefined,
    })
    const dirty = secretFormDirty(controller, secret)
    return {
        secret,
        owners,
        owner,
        setOwner,
        askOwner,
        projectName,
        controller,
        dirty,
        // An edit saves only once something changed.
        valid:
            Boolean(controller.name.trim()) &&
            (!secret || dirty) &&
            !controller.okDisabled &&
            !controller.saving,
        saving: controller.saving,
        save: async () => Boolean(await controller.submit()),
        title: secret
            ? t("settings.secretFormSheet.editTitle")
            : t("settings.secretFormSheet.createSecret"),
        saveLabel: secret ? undefined : t("settings.secretFormSheet.createSecret"),
        nameHelp: t("settings.secretFormSheet.description"),
    }
}

export type SecretFormSetup = ReturnType<typeof useSecretFormSetup>

/** The form's fields: name, format, value and the rest, then the Owner when it asks for one. */
export const SecretFormFields = ({setup}: {setup: SecretFormSetup}) => (
    <>
        <SecretForm controller={setup.controller} nameHelp={setup.nameHelp} />
        {setup.askOwner && setup.owners ? (
            <OwnerField<SecretOwner>
                value={setup.owner}
                owners={setup.owners}
                onChange={setup.setOwner}
                projectName={setup.projectName}
            />
        ) : null}
    </>
)
