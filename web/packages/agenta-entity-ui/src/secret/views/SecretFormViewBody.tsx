import {useMemo, useState} from "react"

import {
    CustomSecretFormat,
    personalNamedSecretsAtom,
    useVaultSecret,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import secretViewsCatalog from "@agenta/i18n/catalogs/entityUi.secretViews"
import secretFormSheetCatalog from "@agenta/i18n/catalogs/settings.secretFormSheet"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {ACCOUNT_COPY} from "../../accounts/copy"
import {useProjectName} from "../../accounts/useProjectName"
import type {SecretOwner} from "../attach/useSecretAttachForm"
import {OwnerRadioGroup} from "../OwnerRadioGroup"
import {SecretForm, useSecretForm, type SecretFormController} from "../SecretForm"
import {objectToRows} from "../SecretForm/primitives"

import type {SecretFormViewParams} from "./secretFormView"

/** The form differs from the secret it opened with (or, for a new one, holds any text). */
export const secretFormDirty = (
    form: Pick<SecretFormController, "name" | "textValue" | "defaultEnvVar" | "kvRows" | "format">,
    secret: NamedSecretRow | null,
): boolean => {
    const keys = JSON.stringify(form.kvRows.filter((row) => row.key.trim() || row.value))
    if (!secret) return Boolean(form.name.trim() || form.textValue.trim() || keys !== "[]")
    const savedText = typeof secret.content === "string" ? secret.content : ""
    const savedRows =
        secret.format === CustomSecretFormat.Json &&
        secret.content &&
        typeof secret.content === "object"
            ? JSON.stringify(objectToRows(secret.content))
            : "[]"
    return (
        form.name !== (secret.name ?? "") ||
        form.format !== secret.format ||
        form.defaultEnvVar !== (secret.defaultEnvVar ?? "") ||
        (form.format === CustomSecretFormat.Text
            ? form.textValue !== savedText
            : keys !== savedRows)
    )
}

const SecretFormViewBody = ({params}: ViewProps<SecretFormViewParams>) => {
    const t = useT(secretFormSheetCatalog, secretViewsCatalog)
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
        ownerKind: secret
            ? secret.ownerKind === "user"
                ? "user"
                : undefined
            : owner === "user"
              ? "user"
              : undefined,
    })
    const dirty = useMemo(() => secretFormDirty(controller, secret), [controller, secret])
    useViewTitle(
        secret
            ? t("settings.secretFormSheet.editTitle")
            : t("settings.secretFormSheet.createSecret"),
    )
    useViewForm({
        dirty,
        valid: Boolean(controller.name.trim()) && !controller.okDisabled && !controller.saving,
        save: async () => Boolean(await controller.submit()),
        leaveDescription: t("entityUi.secretViews.formLeaveDescription"),
        saveLabel: secret ? undefined : t("settings.secretFormSheet.createSecret"),
    })

    return (
        <div className="flex flex-col gap-4 px-4 py-3">
            <p className="m-0 text-xs text-colorTextSecondary">
                {t("settings.secretFormSheet.description")}
            </p>
            <SecretForm controller={controller} />
            {askOwner ? (
                <div className="flex flex-col gap-1">
                    <span className="font-medium text-colorText">{ACCOUNT_COPY.whoCanUseIt}</span>
                    <OwnerRadioGroup<SecretOwner>
                        value={owner}
                        onChange={setOwner}
                        options={[
                            {
                                value: "user",
                                label: ACCOUNT_COPY.onlyMe,
                                note: ACCOUNT_COPY.onlyMeSecretNote,
                            },
                            {
                                value: "project",
                                label: ACCOUNT_COPY.everyoneIn(projectName),
                                note: ACCOUNT_COPY.everyoneSecretNote,
                            },
                        ]}
                    />
                </div>
            ) : null}
        </div>
    )
}

export default SecretFormViewBody
