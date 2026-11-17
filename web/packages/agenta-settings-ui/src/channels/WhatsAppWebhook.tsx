import {useEffect, useState} from "react"

import {richText, useT} from "@agenta/i18n"
import channelsWhatsappCatalog from "@agenta/i18n/catalogs/channels.whatsapp"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button, Input} from "@agenta/ui/ui"
import {Check, Copy} from "@phosphor-icons/react"

import type {ChannelConnection} from "./types"

export const copyText = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}

const CopyField = ({label, value, testId}: {label: string; value: string; testId: string}) => {
    const t = useT(channelsWhatsappCatalog, commonCatalog)
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => setCopied(false), 1800)
        return () => clearTimeout(timer)
    }, [copied])
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-colorText">{label}</span>
            <span className="flex gap-2">
                <Input readOnly value={value} className="font-mono text-xs" data-testid={testId} />
                <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("channels.whatsapp.copyField", {
                        label: label.toLowerCase(),
                    })}
                    onClick={async () => setCopied(await copyText(value))}
                >
                    {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
                    {copied ? t("common.copied") : t("common.copy")}
                </Button>
            </span>
        </label>
    )
}

/**
 * The callback URL and verify token a WhatsApp connection needs in Meta's App Dashboard.
 * Meta delivers no messages until both are pasted there, so the connect flow shows them right
 * after connecting and the manage view keeps them findable.
 */
export const WhatsAppWebhook = ({connection}: {connection: ChannelConnection}) => {
    const t = useT(channelsWhatsappCatalog, commonCatalog)
    return (
        <div className="flex flex-col gap-3" data-testid="channels-whatsapp-webhook">
            <p className="m-0 text-xs leading-relaxed text-colorTextSecondary">
                {richText(t("channels.whatsapp.webhookHint"), {
                    code: (text) => <code>{text}</code>,
                })}
            </p>
            <CopyField
                label={t("channels.whatsapp.callbackUrl")}
                value={connection.webhookUrl ?? ""}
                testId="channels-whatsapp-webhook-url"
            />
            <CopyField
                label={t("channels.whatsapp.verifyToken")}
                value={connection.webhookVerifyToken ?? ""}
                testId="channels-whatsapp-verify-token"
            />
        </div>
    )
}
