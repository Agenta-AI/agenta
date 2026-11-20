/** The fields of "Attach a secret" (F04 f4 to f7), in the attach view and in the dock's modal. */
import {useRef} from "react"

import {richText, useT} from "@agenta/i18n"
import secretAttachmentCatalog from "@agenta/i18n/catalogs/entityUi.secretAttachment"
import secretViewsCatalog from "@agenta/i18n/catalogs/entityUi.secretViews"
import {
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"

import {ACCOUNT_COPY} from "../../accounts/copy"
import {useProjectName} from "../../accounts/useProjectName"
import type {AgentSecretRequestSeed} from "../agentSecretRules"
import {OwnerRadioGroup} from "../OwnerRadioGroup"
import {SecretCreateFields} from "../SecretCreateFields"

import {NEW_SECRET} from "./secretChoice"
import type {SecretAttachForm, SecretListEntry, SecretOwner} from "./useSecretAttachForm"

const SECRET_FIELD_ID = "agent-secret-attach-secret"
const ENV_FIELD_ID = "agent-secret-attach-env"

/** Who can use a secret: "Everyone" or "Only me", at the right of its name. */
export const SecretScopeTag = ({scope}: {scope: SecretListEntry["scope"]}) => {
    const t = useT(secretViewsCatalog)
    return (
        <span className="ml-auto shrink-0 rounded px-1.5 text-[11px] leading-[18px] text-colorTextSecondary ring-1 ring-inset ring-colorBorderSecondary">
            {scope === "everyone" ? t("entityUi.secretViews.everyone") : ACCOUNT_COPY.onlyMe}
        </span>
    )
}

export function SecretAttachFields({
    form,
    request,
    agentDirty = false,
    container,
    popupZIndex,
}: {
    form: SecretAttachForm
    request?: AgentSecretRequestSeed
    /** The agent has a change that is not saved yet: the production notice shows. */
    agentDirty?: boolean
    /** A host panel the select's list stays within. */
    container?: HTMLElement | null
    popupZIndex?: number
}) {
    const t = useT(secretAttachmentCatalog, secretViewsCatalog)
    const nameRef = useRef<HTMLInputElement>(null)
    const valueRef = useRef<HTMLTextAreaElement>(null)
    const creating = form.choice.kind === "new"
    const projectName = useProjectName(Boolean(form.owners))
    // A seeded name means the value is the only thing left to type.
    const focusNewSecretField = () =>
        (request?.name?.trim() ? valueRef.current : nameRef.current)?.focus()

    return (
        <div className="flex flex-col gap-4">
            {request ? (
                <p className="m-0 text-xs text-colorTextSecondary">
                    {richText(t("entityUi.secretAttachment.agentAskedFor", {name: request.name}), {
                        name: (text) => <span className="font-medium text-colorText">{text}</span>,
                    })}
                    {request.reason ? ` · ${request.reason}` : ""}
                </p>
            ) : null}

            <div className="flex flex-col gap-1">
                <label htmlFor={SECRET_FIELD_ID} className="font-medium text-colorText">
                    {t("entityUi.secretAttachment.secret")}
                </label>
                <Select value={form.selected} onValueChange={form.select} disabled={form.loading}>
                    <SelectTrigger
                        id={SECRET_FIELD_ID}
                        className="[&>span:first-child]:flex [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:items-center [&>span:first-child]:gap-2"
                    >
                        <SelectValue
                            placeholder={
                                form.loading
                                    ? t("entityUi.secretAttachment.loadingSecrets")
                                    : t("entityUi.secretAttachment.selectSecret")
                            }
                        />
                    </SelectTrigger>
                    <SelectContent
                        container={container}
                        style={popupZIndex ? {zIndex: popupZIndex} : undefined}
                        // Radix hands focus back to the trigger on close; send it to the new fields.
                        onCloseAutoFocus={(event) => {
                            if (form.selected !== NEW_SECRET) return
                            event.preventDefault()
                            focusNewSecretField()
                        }}
                    >
                        {form.entries.map((entry) => (
                            <SelectItem
                                key={entry.value}
                                value={entry.value}
                                className="[&>span:first-child]:flex [&>span:first-child]:items-center [&>span:first-child]:gap-2"
                            >
                                <span className="min-w-0 truncate">{entry.name}</span>
                                <SecretScopeTag scope={entry.scope} />
                            </SelectItem>
                        ))}
                        {form.canCreate ? (
                            <>
                                {form.entries.length > 0 ? <SelectSeparator /> : null}
                                <SelectItem value={NEW_SECRET}>
                                    {ACCOUNT_COPY.createNewSecret}
                                </SelectItem>
                            </>
                        ) : null}
                    </SelectContent>
                </Select>
                {form.choice.kind === "own" ? (
                    <span className="text-xs text-colorTextSecondary">
                        {t("entityUi.secretViews.onlyYouLine")}
                    </span>
                ) : null}
            </div>

            {creating ? (
                <>
                    <SecretCreateFields
                        controller={form.createController}
                        focusValue={!!request?.name?.trim()}
                        hint={
                            form.owner === "user"
                                ? undefined
                                : t("entityUi.secretAttachment.storedInVault")
                        }
                        nameRef={nameRef}
                        valueRef={valueRef}
                        onNameChange={form.onNewSecretName}
                    />
                    {form.owners ? (
                        <div className="flex flex-col gap-1">
                            <span className="font-medium text-colorText">
                                {ACCOUNT_COPY.whoCanUseIt}
                            </span>
                            <OwnerRadioGroup<SecretOwner>
                                value={form.owner}
                                onChange={form.setOwner}
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
                </>
            ) : null}

            <div className="flex flex-col gap-1">
                <label htmlFor={ENV_FIELD_ID} className="font-medium text-colorText">
                    {t("entityUi.secretAttachment.environmentVariable")}
                </label>
                <Input
                    id={ENV_FIELD_ID}
                    className="font-mono"
                    value={form.envVar}
                    placeholder={t("entityUi.secretAttachment.envPlaceholder")}
                    onChange={(event) => form.setEnvVar(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={form.envError ? true : undefined}
                />
                <span
                    className={`text-xs ${form.envError ? "text-error" : "text-colorTextSecondary"}`}
                >
                    {form.envError === "invalid"
                        ? t("entityUi.secretAttachment.envInvalid")
                        : form.envError === "duplicate"
                          ? t("entityUi.secretAttachment.alreadyAttached")
                          : t("entityUi.secretAttachment.receivesThrough")}
                </span>
            </div>

            {agentDirty ? (
                <div className="rounded-lg border border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] p-3 text-xs text-colorText">
                    {t("entityUi.secretAttachment.saveOrDiscard")}
                </div>
            ) : null}
            {form.error ? (
                <div
                    role="alert"
                    className="rounded-lg border border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg)] p-3 text-xs text-error"
                >
                    {form.error}
                </div>
            ) : null}
        </div>
    )
}
