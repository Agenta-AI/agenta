import {useCallback, useEffect, useState} from "react"

import {useT} from "@agenta/i18n/channels"
import {Alert, Button, Checkbox, RadioGroup, RadioGroupItem, Spinner, Switch} from "@agenta/ui/ui"
import {CaretDown, CaretRight} from "@phosphor-icons/react"

import {errorMessage} from "./helpers"
import type {
    ChannelBehaviorState,
    ChannelPlatform,
    ChannelSpace,
    ChannelReadableChannel,
    ChannelToolSettings,
    ChannelsActions,
} from "./types"

/**
 * What the agent's channel tools may do through this bot: post outside the conversation that
 * woke it, and which channels it may search and read. Collapsed by default, and it loads
 * nothing until opened. Every control is editable; a refused save shows the message and the
 * value the backend still holds.
 */

export interface ChannelAnswersInProps {
    /** Where the agent answers now; null while it loads. */
    behavior: ChannelBehaviorState | null
    /** The channels (or groups) the bot is in that have a place row, for the checklist. */
    channels: ChannelSpace[]
    /** Save "Channels it answers in": null for every channel, else the chosen space ids. */
    onSave: (channels: string[] | null) => Promise<void>
    /** True while any save of where it answers runs (this row or a switch). */
    busy?: boolean
}

export interface ChannelAdvancedSectionProps {
    platform: ChannelPlatform
    connectionId: string
    actions: ChannelsActions
    /** The "Channels it answers in" row; left out where the agent answers only in DMs. */
    answersIn?: ChannelAnswersInProps
}

type Choice = "all" | "only"

const CARD = "overflow-hidden rounded-lg border border-solid border-colorBorderSecondary"
const DIVIDED = "border-0 border-t border-solid border-colorBorderSecondary"
const HELP = "text-xs leading-normal text-colorTextSecondary"

/**
 * "Channels it answers in" ("Groups it answers in" on Telegram): every channel the bot is in, or
 * only the checked ones. A channel left unchecked stays listed in the panel, marked Off, and a
 * channel the bot joins later stays off until it is checked.
 */
const AnswersInRow = ({
    isSlack,
    answersIn,
}: {
    isSlack: boolean
    answersIn: ChannelAnswersInProps
}) => {
    const t = useT()
    const {behavior, channels, onSave, busy = false} = answersIn
    const stored = behavior?.spaceIds ?? null
    const [choice, setChoice] = useState<Choice>(stored === null ? "all" : "only")
    const [draft, setDraft] = useState<string[]>(stored ?? [])
    const [ownSave, setOwnSave] = useState(false)
    // off while any save of where it answers runs; the spinner only for this row's own
    const saving = ownSave || busy
    const [error, setError] = useState<string | null>(null)

    // Follow what the backend holds after every save or switch change.
    const storedKey = stored === null ? "all" : stored.join(",")
    useEffect(() => {
        setChoice(stored === null ? "all" : "only")
        setDraft(stored ?? [])
    }, [storedKey])

    const save = async (next: string[] | null) => {
        setOwnSave(true)
        setError(null)
        try {
            await onSave(next)
        } catch (e) {
            // Show what the backend still holds, not what the refused save asked for.
            setChoice(stored === null ? "all" : "only")
            setDraft(stored ?? [])
            setError(errorMessage(e, t("channels.actions.saveSettingFailed")))
        } finally {
            setOwnSave(false)
        }
    }

    const choose = (value: string) => {
        if (value === "all") {
            setChoice("all")
            if (stored !== null) void save(null)
            return
        }
        setChoice("only")
        setDraft(stored ?? [])
    }

    const title = isSlack
        ? t("channels.advanced.channelsAnswersIn")
        : t("channels.advanced.groupsAnswersIn")

    return (
        <div
            className={`flex flex-col gap-2.5 px-3 py-3 ${DIVIDED}`}
            data-testid="channels-advanced-answers"
        >
            <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-colorText">{title}</span>
                <span className={HELP}>
                    {isSlack
                        ? t("channels.advanced.answersInHelpSlack")
                        : t("channels.advanced.answersInHelp")}
                </span>
            </span>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            {behavior === null ? (
                <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                    <Spinner size="small" /> {t("channels.labels.loading")}
                </div>
            ) : !behavior.group ? (
                <span className={HELP}>
                    {isSlack
                        ? t("channels.advanced.channelsSwitchedOff")
                        : t("channels.advanced.groupsSwitchedOff")}
                </span>
            ) : (
                <>
                    <RadioGroup
                        value={choice}
                        onValueChange={choose}
                        disabled={saving}
                        aria-label={title}
                    >
                        {(
                            [
                                [
                                    "all",
                                    isSlack
                                        ? t("channels.advanced.allChannels")
                                        : t("channels.advanced.allGroups"),
                                ],
                                [
                                    "only",
                                    isSlack
                                        ? t("channels.advanced.onlyTheseChannels")
                                        : t("channels.advanced.onlyTheseGroups"),
                                ],
                            ] as const
                        ).map(([value, label]) => (
                            <label
                                key={value}
                                className="flex cursor-pointer items-center gap-2 text-[13px] text-colorText"
                            >
                                <RadioGroupItem
                                    value={value}
                                    data-testid={`channels-advanced-answers-${value}`}
                                />
                                {label}
                            </label>
                        ))}
                    </RadioGroup>
                    {choice === "only" ? (
                        <div
                            className="flex flex-col gap-2 rounded-md bg-colorFillQuaternary p-2.5"
                            data-testid="channels-advanced-answers-checklist"
                        >
                            {channels.length === 0 ? (
                                <span className="text-xs text-colorTextTertiary">
                                    {isSlack
                                        ? t("channels.advanced.noChannelYet")
                                        : t("channels.advanced.noGroupYet")}
                                </span>
                            ) : (
                                channels.map((channel) => (
                                    <label
                                        key={channel.id}
                                        className="flex min-w-0 cursor-pointer items-center gap-2 text-[13px] text-colorText"
                                    >
                                        <Checkbox
                                            checked={draft.includes(channel.id)}
                                            disabled={saving}
                                            onCheckedChange={(value) =>
                                                setDraft((ids) =>
                                                    value === true
                                                        ? [...ids, channel.id]
                                                        : ids.filter((id) => id !== channel.id),
                                                )
                                            }
                                            data-testid={`channels-advanced-answers-channel-${channel.id}`}
                                        />
                                        <span className="truncate">{channel.name}</span>
                                    </label>
                                ))
                            )}
                            <span className={HELP}>
                                {draft.length === 0
                                    ? isSlack
                                        ? t("channels.advanced.noChannelCheckedAnswers")
                                        : t("channels.advanced.noGroupCheckedAnswers")
                                    : isSlack
                                      ? t("channels.advanced.channelJoinsLater")
                                      : t("channels.advanced.groupJoinsLater")}
                            </span>
                            <div className="flex justify-end">
                                <Button
                                    size="sm"
                                    disabled={saving}
                                    onClick={() => void save(draft)}
                                    data-testid="channels-advanced-answers-save"
                                >
                                    {ownSave ? <Spinner size="small" /> : null}
                                    {t("common.save")}
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </>
            )}
        </div>
    )
}

export const ChannelAdvancedSection = ({
    platform,
    connectionId,
    actions,
    answersIn,
}: ChannelAdvancedSectionProps) => {
    const t = useT()
    const isSlack = platform === "slack"
    const [open, setOpen] = useState(false)
    const [settings, setSettings] = useState<ChannelToolSettings | null>(null)
    const [choice, setChoice] = useState<Choice>("all")
    const [draft, setDraft] = useState<string[]>([])
    const [channels, setChannels] = useState<ChannelReadableChannel[] | null>(null)
    const [channelsError, setChannelsError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const show = (stored: ChannelToolSettings) => {
        setSettings(stored)
        setChoice(stored.readableSpaceKeys === null ? "all" : "only")
        setDraft(stored.readableSpaceKeys ?? [])
    }

    const load = useCallback(async () => {
        setError(null)
        try {
            show(await actions.readToolSettings(connectionId))
        } catch (e) {
            setSettings(null)
            setError(errorMessage(e, t("channels.actions.readBotSettingsFailed")))
        }
    }, [actions, connectionId, t])

    useEffect(() => {
        if (!open) return
        void load()
        setChannelsError(null)
        actions
            .listReadableChannels(platform, connectionId)
            .then(setChannels)
            .catch((e) => {
                setChannels([])
                setChannelsError(errorMessage(e, t("channels.advanced.listChannelsFailed")))
            })
    }, [open, load, actions, platform, connectionId, t])

    const save = async (next: ChannelToolSettings) => {
        setSaving(true)
        setError(null)
        try {
            await actions.writeToolSettings(connectionId, next)
            // A posting-only save keeps an unsaved channel checklist as it is.
            if (settings && next.readableSpaceKeys === settings.readableSpaceKeys) setSettings(next)
            else show(next)
        } catch (e) {
            const message = errorMessage(e, t("channels.actions.saveSettingFailed"))
            // Show what the backend still holds, not what the refused save asked for.
            await load()
            setError(message)
        } finally {
            setSaving(false)
        }
    }

    const choose = (value: string) => {
        if (!settings) return
        if (value === "all") {
            setChoice("all")
            if (settings.readableSpaceKeys !== null)
                void save({...settings, readableSpaceKeys: null})
            return
        }
        setChoice("only")
        setDraft(settings.readableSpaceKeys ?? [])
    }

    const toggleChannel = (key: string, checked: boolean) =>
        setDraft((keys) => (checked ? [...keys, key] : keys.filter((k) => k !== key)))

    return (
        <div className="flex flex-col gap-2" data-testid="channels-advanced">
            <button
                type="button"
                className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-colorText"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                data-testid="channels-advanced-toggle"
            >
                {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
                {t("channels.advanced.advanced")}
            </button>

            {open ? (
                <div className="flex flex-col gap-2">
                    {error ? <Alert type="error" showIcon message={error} /> : null}
                    {settings === null ? (
                        error ? null : (
                            <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                                <Spinner size="small" /> {t("channels.labels.loading")}
                            </div>
                        )
                    ) : (
                        <div className={CARD}>
                            <div className="flex items-center gap-3 px-3 py-3">
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="text-[13px] font-medium text-colorText">
                                        {t("channels.advanced.canPostOutside")}
                                    </span>
                                    <span className={HELP}>
                                        {isSlack
                                            ? t("channels.advanced.canPostHelpChannel")
                                            : t("channels.advanced.canPostHelpGroup")}
                                    </span>
                                </span>
                                <Switch
                                    size="sm"
                                    checked={settings.canPostOutsideConversation}
                                    disabled={saving}
                                    onCheckedChange={(value) =>
                                        void save({...settings, canPostOutsideConversation: value})
                                    }
                                    aria-label={t("channels.advanced.canPostOutside")}
                                    data-testid="channels-advanced-post"
                                />
                            </div>

                            <div className={`flex flex-col gap-2.5 px-3 py-3 ${DIVIDED}`}>
                                <span className="flex flex-col gap-0.5">
                                    <span className="text-[13px] font-medium text-colorText">
                                        {t("channels.advanced.canSearchRead")}
                                    </span>
                                    {isSlack ? null : (
                                        <span
                                            className={HELP}
                                            data-testid="channels-advanced-telegram-help"
                                        >
                                            {t("channels.advanced.telegramReadHelp")}
                                        </span>
                                    )}
                                </span>
                                <RadioGroup
                                    value={choice}
                                    onValueChange={choose}
                                    disabled={saving}
                                    aria-label={t("channels.advanced.canSearchRead")}
                                >
                                    {(
                                        [
                                            ["all", t("channels.advanced.allChannels")],
                                            ["only", t("channels.advanced.onlyTheseChannels")],
                                        ] as const
                                    ).map(([value, label]) => (
                                        <label
                                            key={value}
                                            className="flex cursor-pointer items-center gap-2 text-[13px] text-colorText"
                                        >
                                            <RadioGroupItem
                                                value={value}
                                                data-testid={`channels-advanced-read-${value}`}
                                            />
                                            {label}
                                        </label>
                                    ))}
                                </RadioGroup>

                                {choice === "only" ? (
                                    <div
                                        className="flex flex-col gap-2 rounded-md bg-colorFillQuaternary p-2.5"
                                        data-testid="channels-advanced-checklist"
                                    >
                                        {channelsError ? (
                                            <Alert type="error" showIcon message={channelsError} />
                                        ) : null}
                                        {channels === null ? (
                                            <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                                                <Spinner size="small" />{" "}
                                                {t("channels.labels.loading")}
                                            </div>
                                        ) : channels.length === 0 ? (
                                            channelsError ? null : (
                                                <span className="text-xs text-colorTextTertiary">
                                                    {isSlack
                                                        ? t("channels.advanced.noChannelYet")
                                                        : t("channels.advanced.noGroupYet")}
                                                </span>
                                            )
                                        ) : (
                                            channels.map((channel) => (
                                                <label
                                                    key={channel.key}
                                                    className="flex min-w-0 cursor-pointer items-center gap-2 text-[13px] text-colorText"
                                                >
                                                    <Checkbox
                                                        checked={draft.includes(channel.key)}
                                                        disabled={saving}
                                                        onCheckedChange={(value) =>
                                                            toggleChannel(
                                                                channel.key,
                                                                value === true,
                                                            )
                                                        }
                                                        data-testid={`channels-advanced-channel-${channel.key}`}
                                                    />
                                                    <span className="truncate">{channel.name}</span>
                                                </label>
                                            ))
                                        )}
                                        {draft.length === 0 ? (
                                            <span className={HELP}>
                                                {isSlack
                                                    ? t("channels.advanced.noChannelCheckedRead")
                                                    : t("channels.advanced.noGroupCheckedRead")}
                                            </span>
                                        ) : null}
                                        <div className="flex justify-end">
                                            <Button
                                                size="sm"
                                                disabled={saving}
                                                onClick={() =>
                                                    void save({
                                                        ...settings,
                                                        readableSpaceKeys: draft,
                                                    })
                                                }
                                                data-testid="channels-advanced-save"
                                            >
                                                {saving ? <Spinner size="small" /> : null}
                                                {t("common.save")}
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                            {answersIn ? (
                                <AnswersInRow isSlack={isSlack} answersIn={answersIn} />
                            ) : null}
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    )
}
