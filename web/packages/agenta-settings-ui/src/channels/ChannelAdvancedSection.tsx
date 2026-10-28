import {useCallback, useEffect, useState} from "react"

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
    const {behavior, channels, onSave} = answersIn
    const noun = isSlack ? "channel" : "group"
    const stored = behavior?.channels ?? null
    const [choice, setChoice] = useState<Choice>(stored === null ? "all" : "only")
    const [draft, setDraft] = useState<string[]>(stored ?? [])
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Follow what the backend holds after every save or switch change.
    const storedKey = stored === null ? "all" : stored.join(",")
    useEffect(() => {
        setChoice(stored === null ? "all" : "only")
        setDraft(stored ?? [])
    }, [storedKey])

    const save = async (next: string[] | null) => {
        setSaving(true)
        setError(null)
        try {
            await onSave(next)
        } catch (e) {
            // Show what the backend still holds, not what the refused save asked for.
            setChoice(stored === null ? "all" : "only")
            setDraft(stored ?? [])
            setError(errorMessage(e, "Could not save this setting."))
        } finally {
            setSaving(false)
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

    const title = isSlack ? "Channels it answers in" : "Groups it answers in"

    return (
        <div
            className={`flex flex-col gap-2.5 px-3 py-3 ${DIVIDED}`}
            data-testid="channels-advanced-answers"
        >
            <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-colorText">{title}</span>
                <span className={HELP}>
                    Where it answers when mentioned. {isSlack ? "Direct messages" : "Private chats"}{" "}
                    follow the switch above.{isSlack ? " Channels include group DMs." : ""}
                </span>
            </span>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            {behavior === null ? (
                <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                    <Spinner size="small" /> Loading…
                </div>
            ) : !behavior.group ? (
                <span className={HELP}>
                    {isSlack ? "Channels" : "Group chats"} are switched off above, so it answers in
                    none.
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
                                ["all", `All ${noun}s the bot is in`],
                                ["only", `Only these ${noun}s`],
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
                                    The bot is in no {noun} yet.
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
                                    ? `With no ${noun} checked, the agent answers in no ${noun}.`
                                    : `A ${noun} the bot joins later stays off until you check it.`}
                            </span>
                            <div className="flex justify-end">
                                <Button
                                    size="sm"
                                    disabled={saving}
                                    onClick={() => void save(draft)}
                                    data-testid="channels-advanced-answers-save"
                                >
                                    {saving ? <Spinner size="small" /> : null}
                                    Save
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
            setError(errorMessage(e, "Could not read this bot's settings."))
        }
    }, [actions, connectionId])

    useEffect(() => {
        if (!open) return
        void load()
        setChannelsError(null)
        actions
            .listReadableChannels(platform, connectionId)
            .then(setChannels)
            .catch((e) => {
                setChannels([])
                setChannelsError(errorMessage(e, "Could not list the channels the bot is in."))
            })
    }, [open, load, actions, platform, connectionId])

    const save = async (next: ChannelToolSettings) => {
        setSaving(true)
        setError(null)
        try {
            await actions.writeToolSettings(connectionId, next)
            // A posting-only save keeps an unsaved channel checklist as it is.
            if (settings && next.readableSpaceKeys === settings.readableSpaceKeys) setSettings(next)
            else show(next)
        } catch (e) {
            const message = errorMessage(e, "Could not save this setting.")
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

    const noun = isSlack ? "channel" : "group"

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
                Advanced
            </button>

            {open ? (
                <div className="flex flex-col gap-2">
                    {error ? <Alert type="error" showIcon message={error} /> : null}
                    {settings === null ? (
                        error ? null : (
                            <div className="flex items-center gap-2 text-xs text-colorTextSecondary">
                                <Spinner size="small" /> Loading…
                            </div>
                        )
                    ) : (
                        <div className={CARD}>
                            <div className="flex items-center gap-3 px-3 py-3">
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="text-[13px] font-medium text-colorText">
                                        Can post outside the conversation
                                    </span>
                                    <span className={HELP}>
                                        Whether the agent may post to a {noun} other than the
                                        conversation it answers in. Its replies there are not
                                        affected.
                                    </span>
                                </span>
                                <Switch
                                    size="sm"
                                    checked={settings.canPostOutsideConversation}
                                    disabled={saving}
                                    onCheckedChange={(value) =>
                                        void save({...settings, canPostOutsideConversation: value})
                                    }
                                    aria-label="Can post outside the conversation"
                                    data-testid="channels-advanced-post"
                                />
                            </div>

                            <div className={`flex flex-col gap-2.5 px-3 py-3 ${DIVIDED}`}>
                                <span className="flex flex-col gap-0.5">
                                    <span className="text-[13px] font-medium text-colorText">
                                        Channels it can search and read
                                    </span>
                                    {isSlack ? null : (
                                        <span
                                            className={HELP}
                                            data-testid="channels-advanced-telegram-help"
                                        >
                                            Telegram does not let bots read chat history, so the bot
                                            can read only messages it received.
                                        </span>
                                    )}
                                </span>
                                <RadioGroup
                                    value={choice}
                                    onValueChange={choose}
                                    disabled={saving}
                                    aria-label="Channels it can search and read"
                                >
                                    {(
                                        [
                                            ["all", "All channels the bot is in"],
                                            ["only", "Only these channels"],
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
                                                <Spinner size="small" /> Loading…
                                            </div>
                                        ) : channels.length === 0 ? (
                                            channelsError ? null : (
                                                <span className="text-xs text-colorTextTertiary">
                                                    The bot is in no {noun} yet.
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
                                                With no {noun} checked, the agent cannot search or
                                                read any.
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
                                                Save
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
