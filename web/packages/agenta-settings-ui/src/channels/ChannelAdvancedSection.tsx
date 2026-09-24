import {useCallback, useEffect, useState} from "react"

import {Alert, Button, Checkbox, RadioGroup, RadioGroupItem, Spinner, Switch} from "@agenta/ui/ui"
import {CaretDown, CaretRight} from "@phosphor-icons/react"

import {errorMessage} from "./helpers"
import type {
    ChannelPlatform,
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

export interface ChannelAdvancedSectionProps {
    platform: ChannelPlatform
    connectionId: string
    actions: ChannelsActions
}

type Choice = "all" | "only"

const CARD = "overflow-hidden rounded-lg border border-solid border-colorBorderSecondary"
const DIVIDED = "border-0 border-t border-solid border-colorBorderSecondary"
const HELP = "text-xs leading-normal text-colorTextSecondary"

export const ChannelAdvancedSection = ({
    platform,
    connectionId,
    actions,
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
            show(next)
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
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    )
}
