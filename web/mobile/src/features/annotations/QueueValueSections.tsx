import type {ReactNode} from "react"

import {
    CopyValueButton,
    ValueCompareRows,
    ValueField,
    ValueFieldTable,
    valueAsText,
    type TurnActivity,
    type ValueFieldTableField,
} from "@agenta/chat/value-view"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {compareWithExpected, detectValueShape} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {ArrowSquareOut, Copy} from "@phosphor-icons/react"

const SectionHeader = ({
    title,
    meta,
    copy,
}: {
    title: string
    meta?: string | null
    copy?: ReactNode
}) => (
    <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="m-0 flex items-baseline gap-2 text-label">
            {title}
            {meta ? (
                <span className="text-meta font-normal text-muted-foreground">{meta}</span>
            ) : null}
        </h3>
        {copy}
    </div>
)

/** An item's inputs as key and value rows. */
export const InputsSection = ({fields}: {fields: ValueFieldTableField[]}) => {
    const t = useT(queueScreensCatalog)
    if (fields.length === 0) return null
    return (
        <section aria-label={t("annotation.queueScreens.inputs")} className="flex flex-col gap-2">
            <SectionHeader
                title={t("annotation.queueScreens.inputs")}
                meta={t("annotation.queueScreens.fieldCount", {count: fields.length})}
                copy={
                    <CopyValueButton
                        value={Object.fromEntries(fields.map((field) => [field.name, field.value]))}
                        label={t("annotation.queueScreens.copyInputs")}
                    />
                }
            />
            <ValueFieldTable fields={fields} />
        </section>
    )
}

/** JSON written as text copies two ways: the parsed JSON, or the string as the model wrote it. */
const JsonTextCopy = ({raw, parsed}: {raw: string; parsed: unknown}) => {
    const t = useT(queueScreensCatalog, valueViewCatalog)
    const copy = (text: string) =>
        void copyToClipboard(text).then((copied) => {
            if (copied) message.success(t("chat.valueView.copied"))
        })
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    aria-label={t("annotation.queueScreens.copyOutput")}
                >
                    <Copy aria-hidden size={12} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => copy(valueAsText(parsed))}>
                    {t("annotation.queueScreens.copyParsed")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => copy(raw)}>
                    {t("annotation.queueScreens.copyRaw")}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/**
 * The app's output, drawn by its shape: a chat (with the tool steps of each turn), JSON written
 * as text (parsed, with its note), or rows against the expected value. A failed app call reads
 * "Error: MESSAGE" with Open trace.
 */
export const OutputSection = ({
    value,
    error,
    turnActivity,
    expected,
    onOpenTrace,
}: {
    value: unknown
    /** The app call failed with this message. */
    error?: string | null
    turnActivity?: readonly TurnActivity[]
    /** The expected value and the test case column it comes from. */
    expected?: {key: string; value: unknown} | null
    onOpenTrace?: (() => void) | null
}) => {
    const t = useT(queueScreensCatalog, valueViewCatalog)
    const detected = detectValueShape(value)
    const isChat = detected.shape === "messages" && !error
    const fromText = Boolean(detected.parsedFromText) && !error
    const comparison =
        expected && !error && expected.value !== undefined
            ? compareWithExpected(value, expected.value)
            : null
    const title = isChat
        ? t("annotation.queueScreens.conversation")
        : t("annotation.queueScreens.output")
    const meta = isChat
        ? t("annotation.queueScreens.messageCount", {
              count: Array.isArray(detected.value) ? detected.value.length : 0,
          })
        : fromText
          ? t("annotation.queueScreens.jsonFromText")
          : null
    const copy = error ? null : fromText && typeof value === "string" ? (
        <JsonTextCopy raw={value} parsed={detected.value} />
    ) : (
        <CopyValueButton value={value} label={t("annotation.queueScreens.copyOutput")} />
    )

    return (
        <section aria-label={title} className="flex flex-col gap-2">
            <SectionHeader title={title} meta={meta} copy={copy} />
            {error ? (
                <div role="alert" className="flex flex-col items-start gap-2">
                    <p className="m-0 whitespace-pre-wrap break-words text-body text-destructive">
                        {t("annotation.queueScreens.errorMessage", {message: error})}
                    </p>
                    {onOpenTrace ? (
                        <Button type="button" variant="ghost" size="sm" onClick={onOpenTrace}>
                            <ArrowSquareOut aria-hidden size={14} />
                            {t("chat.valueView.openTrace")}
                        </Button>
                    ) : null}
                </div>
            ) : comparison && expected ? (
                <ValueCompareRows comparison={comparison} expectedKey={expected.key} />
            ) : (
                <>
                    <ValueField value={value} label={title} turnActivity={turnActivity} />
                    {/* A value the rows cannot compare (text against text) shows under it. */}
                    {expected && expected.value !== undefined && !error ? (
                        <ValueFieldTable fields={[{name: expected.key, value: expected.value}]} />
                    ) : null}
                </>
            )}
            {fromText ? (
                <p className="m-0 text-meta text-muted-foreground">
                    {t("annotation.queueScreens.jsonFromTextNote")}
                </p>
            ) : null}
        </section>
    )
}
