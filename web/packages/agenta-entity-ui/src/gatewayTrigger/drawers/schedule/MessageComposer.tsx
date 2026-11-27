/** The schedule drawer's "Message" field — what the agent is told on each run. */
import {getScheduleMessage, setScheduleMessage} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import triggerScheduleCatalog from "@agenta/i18n/catalogs/entityUi.triggerSchedule"
import {AutosizeTextarea} from "@agenta/ui/ui"

// ---------------------------------------------------------------------------
// MessageComposer — one message, mapped onto the agent's primary input (`messages` for chat
// agents, else a schema string input). The raw-JSON editor this field used to carry is gone,
// so a mapping richer than a single message can no longer be edited here; the warning below is
// the only thing between such a mapping and a silent overwrite.
// ---------------------------------------------------------------------------

export function MessageComposer({
    inputsText,
    onChange,
    isChat,
    primaryKey,
    disabled,
}: {
    inputsText: string
    onChange: (next: string) => void
    isChat: boolean
    primaryKey: string
    disabled?: boolean
}) {
    const t = useT(triggerScheduleCatalog)
    const message = getScheduleMessage(inputsText, isChat, primaryKey)
    // The composer writes a single user message, so anything richer would be lost on edit.
    const wouldReplace = !message && !!inputsText.trim() && inputsText.trim() !== "{}"

    return (
        <div className="flex flex-col gap-1.5">
            <AutosizeTextarea
                placeholder={t("entityUi.triggerSchedule.messagePlaceholder")}
                value={message}
                onChange={(e) =>
                    onChange(setScheduleMessage(inputsText, e.target.value, isChat, primaryKey))
                }
                autoSize={{minRows: 3, maxRows: 8}}
                disabled={disabled}
            />
            {/* The usual hint lives in the host label's "?" (FORM-01); only the warning shows here. */}
            {wouldReplace ? (
                <span className="text-meta leading-snug text-warning">
                    {t("entityUi.triggerSchedule.richerInputsSchedule")}
                </span>
            ) : null}
        </div>
    )
}
