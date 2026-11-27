/** The fields of "Attach a secret" (F04 f4 to f7), in the attach view and in the dock's modal. */
import {useEffect, useRef, useState} from "react"

import {richText, useT} from "@agenta/i18n"
import secretAttachmentCatalog from "@agenta/i18n/catalogs/entityUi.secretAttachment"
import secretViewsCatalog from "@agenta/i18n/catalogs/entityUi.secretViews"
import {
    Field,
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
import {OwnerChip} from "../../accounts/OwnerChip"
import {OwnerField} from "../../accounts/OwnerField"
import {useProjectName} from "../../accounts/useProjectName"
import {NewSecretButton} from "../../mcpEndpoint/components/NewSecretButton"
import type {AgentSecretRequestSeed, SecretOwner} from "../agentSecretRules"
import {SecretCreateFields} from "../SecretCreateFields"

import {SecretAttachSkeleton} from "./SecretAttachSkeleton"
import {NEW_SECRET} from "./secretChoice"
import type {SecretAttachForm} from "./useSecretAttachForm"

const SECRET_FIELD_ID = "agent-secret-attach-secret"
const SECRET_HINT_ID = "agent-secret-attach-secret-hint"
const ENV_FIELD_ID = "agent-secret-attach-env"

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

    if (form.skeleton) return <SecretAttachSkeleton {...form.skeleton} />

    return (
        // One gap at every width (SIZE-02), as the MCP connect form on the canvas.
        <div className="flex flex-col gap-3">
            {request ? (
                <p className="m-0 text-meta text-muted-foreground">
                    {richText(t("entityUi.secretAttachment.agentAskedFor", {name: request.name}), {
                        name: (text) => <span className="font-medium text-foreground">{text}</span>,
                    })}
                    {request.reason ? ` · ${request.reason}` : ""}
                </p>
            ) : null}

            <div className="flex flex-col gap-1.5">
                <Field
                    label={t("entityUi.secretAttachment.secret")}
                    htmlFor={SECRET_FIELD_ID}
                    labelEnd={
                        form.canCreate && !creating ? (
                            <NewSecretButton
                                disabled={form.loading}
                                // The new Name field takes focus as it mounts.
                                onClick={() => form.select(NEW_SECRET)}
                            />
                        ) : undefined
                    }
                >
                    <Select
                        value={form.selected}
                        onValueChange={form.select}
                        disabled={form.loading}
                    >
                        <SelectTrigger
                            id={SECRET_FIELD_ID}
                            size="compact"
                            aria-describedby={
                                form.choice.kind === "user" ? SECRET_HINT_ID : undefined
                            }
                            // The "+" of "Create new secret" shows in the list only, not in the trigger.
                            className="[&>span:first-child>svg]:hidden [&>span:first-child]:flex [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:first-child]:items-center [&>span:first-child]:gap-2"
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
                                    <span className="min-w-0 truncate font-mono">{entry.name}</span>
                                    <span className="ml-auto flex">
                                        <OwnerChip owner={entry.ownerKind} />
                                    </span>
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
                                            className="shrink-0 text-muted-foreground"
                                        />
                                        <span>{ACCOUNT_COPY.createNewSecret}</span>
                                    </SelectItem>
                                </>
                            ) : null}
                        </SelectContent>
                    </Select>
                </Field>
                {/* What the picked choice means, read after it (as HintedField draws it). */}
                {form.choice.kind === "user" ? (
                    <p
                        id={SECRET_HINT_ID}
                        className="m-0 flex items-start gap-2 text-meta leading-normal text-muted-foreground"
                    >
                        <LockSimple size={14} aria-hidden className="mt-px shrink-0" />
                        <span>{t("entityUi.secretViews.onlyYouLine")}</span>
                    </p>
                ) : null}
            </div>

            {creating ? (
                <>
                    <SecretCreateFields
                        controller={form.createController}
                        focusValue={!!request?.name?.trim()}
                        valueTooltip={
                            form.owner === "user"
                                ? undefined
                                : t("entityUi.secretAttachment.storedInVault")
                        }
                        nameRef={nameRef}
                        valueRef={valueRef}
                        onNameChange={form.onNewSecretName}
                    />
                    {form.owners ? (
                        <OwnerField<SecretOwner>
                            value={form.owner}
                            owners={form.owners}
                            onChange={form.setOwner}
                            projectName={projectName}
                        />
                    ) : null}
                </>
            ) : null}

            <Field
                label={t("entityUi.secretAttachment.environmentVariable")}
                tooltip={t("entityUi.secretAttachment.receivesThrough")}
                error={
                    form.envError === "invalid"
                        ? t("entityUi.secretAttachment.envInvalid")
                        : form.envError === "duplicate"
                          ? t("entityUi.secretAttachment.alreadyAttached")
                          : undefined
                }
            >
                <Input
                    id={ENV_FIELD_ID}
                    className="font-mono"
                    value={form.envVar}
                    placeholder={t("entityUi.secretAttachment.envPlaceholder")}
                    onChange={(event) => form.setEnvVar(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                />
            </Field>

            {showDirtyNotice ? (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-meta text-foreground">
                    {t("entityUi.secretAttachment.saveOrDiscard")}
                </div>
            ) : null}
            {form.error ? (
                <div
                    role="alert"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-meta text-destructive"
                >
                    {form.error}
                </div>
            ) : null}
        </div>
    )
}
