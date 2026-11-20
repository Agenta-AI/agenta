/** The fields of "Attach a secret" (F04 f4 to f7), in the attach view and in the dock's modal. */
import {useEffect, useRef, useState} from "react"

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
import {LockSimple, Plus} from "@phosphor-icons/react"

import {ACCOUNT_COPY} from "../../accounts/copy"
import {useProjectName} from "../../accounts/useProjectName"
import type {AgentSecretRequestSeed, SecretOwner} from "../agentSecretRules"
import {OwnerRadioGroup} from "../OwnerRadioGroup"
import {SecretCreateFields} from "../SecretCreateFields"

import {NEW_SECRET} from "./secretChoice"
import type {SecretAttachForm, SecretListEntry} from "./useSecretAttachForm"

const SECRET_FIELD_ID = "agent-secret-attach-secret"
const ENV_FIELD_ID = "agent-secret-attach-env"

/** The canvas form label: 12 px, weight 500, secondary. */
const LABEL_CLASS = "text-[12px] font-medium leading-4 text-colorTextSecondary"
/** The help line under a field. */
const HELP_CLASS = "text-[12px] leading-4"
/**
 * Fields on the canvas scale (13 px, radius 6) from md up; a phone keeps 16 px so iOS does not
 * zoom. The mono line height leaves room for underscores, which a 20 px line clips on Linux.
 */
const FIELD_CLASS = "rounded-[6px] md:text-[13px]"

/**
 * Auto-save leaves the agent's draft dirty until the save lands. The notice shows only when the
 * draft stays dirty for longer than a save takes, so a save in flight does not flash it.
 */
const DIRTY_NOTICE_DELAY_MS = 1500

/** True once `value` has stayed true for `ms`; false at once when it turns false. */
export const useHeldTrue = (value: boolean, ms: number): boolean => {
    const [held, setHeld] = useState(false)
    useEffect(() => {
        if (!value) {
            setHeld(false)
            return
        }
        const timer = setTimeout(() => setHeld(true), ms)
        return () => clearTimeout(timer)
    }, [value, ms])
    return value && held
}

/** Whose a secret is: "Everyone" or "Only me", at the right of its name. */
export const SecretOwnerTag = ({owner}: {owner: SecretListEntry["owner"]}) => {
    const t = useT(secretViewsCatalog)
    return (
        <span className="ml-auto inline-flex h-5 shrink-0 items-center rounded px-[7px] font-sans text-[12px] leading-4 text-colorTextSecondary ring-1 ring-inset ring-colorBorderSecondary">
            {owner === "shared" ? t("entityUi.secretViews.everyone") : ACCOUNT_COPY.onlyMe}
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
    const showDirtyNotice = useHeldTrue(agentDirty, DIRTY_NOTICE_DELAY_MS)
    // A seeded name means the value is the only thing left to type.
    const focusNewSecretField = () =>
        (request?.name?.trim() ? valueRef.current : nameRef.current)?.focus()

    return (
        <div className="flex flex-col gap-3.5">
            {request ? (
                <p className="m-0 text-xs text-colorTextSecondary">
                    {richText(t("entityUi.secretAttachment.agentAskedFor", {name: request.name}), {
                        name: (text) => <span className="font-medium text-colorText">{text}</span>,
                    })}
                    {request.reason ? ` · ${request.reason}` : ""}
                </p>
            ) : null}

            <div className="flex flex-col gap-1">
                <label htmlFor={SECRET_FIELD_ID} className={LABEL_CLASS}>
                    {t("entityUi.secretAttachment.secret")}
                </label>
                <Select value={form.selected} onValueChange={form.select} disabled={form.loading}>
                    <SelectTrigger
                        id={SECRET_FIELD_ID}
                        // The "+" of "Create new secret" shows in the list only, not in the trigger.
                        className="md:h-9 md:rounded-[6px] md:text-[13px] [&>span:first-child>svg]:hidden [&>span:first-child]:flex [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:items-center [&>span:first-child]:gap-2"
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
                                <span className="min-w-0 truncate font-mono text-[13px]">
                                    {entry.name}
                                </span>
                                <SecretOwnerTag owner={entry.owner} />
                            </SelectItem>
                        ))}
                        {form.canCreate ? (
                            <>
                                {form.entries.length > 0 ? <SelectSeparator /> : null}
                                <SelectItem
                                    value={NEW_SECRET}
                                    className="[&>span:first-child]:flex [&>span:first-child]:items-center [&>span:first-child]:gap-2"
                                >
                                    <Plus
                                        size={14}
                                        aria-hidden
                                        className="shrink-0 text-colorTextSecondary"
                                    />
                                    <span className="md:text-[13px]">
                                        {ACCOUNT_COPY.createNewSecret}
                                    </span>
                                </SelectItem>
                            </>
                        ) : null}
                    </SelectContent>
                </Select>
                {form.choice.kind === "user" ? (
                    <span
                        className={`mt-1 flex items-start gap-2 text-colorTextSecondary ${HELP_CLASS}`}
                    >
                        <LockSimple
                            size={14}
                            aria-hidden
                            className="mt-px shrink-0 text-colorTextTertiary"
                        />
                        <span>{t("entityUi.secretViews.onlyYouLine")}</span>
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
                            <span className={LABEL_CLASS}>{ACCOUNT_COPY.whoCanUseIt}</span>
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
                <label htmlFor={ENV_FIELD_ID} className={LABEL_CLASS}>
                    {t("entityUi.secretAttachment.environmentVariable")}
                </label>
                <Input
                    id={ENV_FIELD_ID}
                    className={`h-[34px] py-0 font-mono leading-6 ${FIELD_CLASS}`}
                    value={form.envVar}
                    placeholder={t("entityUi.secretAttachment.envPlaceholder")}
                    onChange={(event) => form.setEnvVar(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={form.envError ? true : undefined}
                />
                <span
                    className={`${HELP_CLASS} ${form.envError ? "text-error" : "text-colorTextTertiary"}`}
                >
                    {form.envError === "invalid"
                        ? t("entityUi.secretAttachment.envInvalid")
                        : form.envError === "duplicate"
                          ? t("entityUi.secretAttachment.alreadyAttached")
                          : t("entityUi.secretAttachment.receivesThrough")}
                </span>
            </div>

            {showDirtyNotice ? (
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
