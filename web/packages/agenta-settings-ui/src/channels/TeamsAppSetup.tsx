import {useState} from "react"

import {useT} from "@agenta/i18n"
import channelsTeamsCatalog from "@agenta/i18n/catalogs/channels.teams"
import {Alert, Button, Spinner} from "@agenta/ui/ui"
import {DownloadSimple} from "@phosphor-icons/react"

import {downloadSetupDocument, errorMessage} from "./helpers"
import type {ChannelConnection, ChannelsActions} from "./types"
import {CopyField} from "./WhatsAppWebhook"

const TITLE = "text-[13px] font-medium text-foreground"
const BODY = "m-0 text-xs leading-relaxed text-colorTextSecondary"

/** The messaging endpoint and the app package download of a Teams connection. */
export const TeamsAppSetup = ({
    connection,
    actions,
}: {
    connection: ChannelConnection
    actions: ChannelsActions
}) => {
    const t = useT(channelsTeamsCatalog)
    const [downloading, setDownloading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // The package is read only on click: the zip is large, and most visits never need it.
    const download = async () => {
        if (!connection.connectionId) return
        setDownloading(true)
        setError(null)
        try {
            const document = await actions.teamsAppPackage(connection.connectionId)
            if (!document || !downloadSetupDocument(document))
                setError(t("channels.teams.loadError"))
        } catch (e) {
            setError(errorMessage(e, t("channels.teams.loadError")))
        } finally {
            setDownloading(false)
        }
    }

    return (
        <div className="flex flex-col gap-5" data-testid="channels-teams-app">
            <div className="flex flex-col gap-2">
                <span className={TITLE}>{t("channels.teams.endpointTitle")}</span>
                <p className={BODY}>{t("channels.teams.endpointBody")}</p>
                <CopyField
                    label={t("channels.teams.endpointLabel")}
                    value={connection.webhookUrl ?? ""}
                    testId="channels-teams-endpoint"
                />
            </div>
            <div className="flex flex-col gap-2">
                <span className={TITLE}>{t("channels.teams.installTitle")}</span>
                <div>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={downloading || !connection.connectionId}
                        onClick={() => void download()}
                        data-testid="channels-teams-download"
                    >
                        {downloading ? (
                            <Spinner size="small" />
                        ) : (
                            <DownloadSimple data-icon="inline-start" />
                        )}
                        {t("channels.teams.download")}
                    </Button>
                </div>
                {error ? (
                    <Alert
                        type="error"
                        showIcon
                        message={error}
                        data-testid="channels-teams-download-error"
                    />
                ) : null}
                <p className={BODY}>{t("channels.teams.upload")}</p>
                <p className={BODY}>{t("channels.teams.noUpload")}</p>
            </div>
        </div>
    )
}
