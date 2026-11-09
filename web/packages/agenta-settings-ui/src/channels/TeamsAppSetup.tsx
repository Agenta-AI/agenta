import {useState} from "react"

import {Alert, Button, Spinner} from "@agenta/ui/ui"
import {DownloadSimple} from "@phosphor-icons/react"

import {downloadSetupDocument, errorMessage} from "./helpers"
import {TEAMS_APP_STEPS} from "./teamsSetupCopy"
import type {ChannelConnection, ChannelsActions} from "./types"
import {CopyField} from "./WhatsAppWebhook"

const TITLE = "text-[13px] font-medium text-foreground"
const BODY = "m-0 text-xs leading-relaxed text-colorTextSecondary"

/**
 * What a Teams connection needs after it is stored: the messaging endpoint to paste into the
 * bot, and the app package to upload in Teams. The connect flow shows it right after connecting
 * and the manage view keeps it findable.
 */
export const TeamsAppSetup = ({
    connection,
    actions,
}: {
    connection: ChannelConnection
    actions: ChannelsActions
}) => {
    const [downloading, setDownloading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const {endpoint, install} = TEAMS_APP_STEPS

    // The package is read only on click: the zip is large, and most visits never need it.
    const download = async () => {
        if (!connection.connectionId) return
        setDownloading(true)
        setError(null)
        try {
            const document = await actions.teamsAppPackage(connection.connectionId)
            if (!document || !downloadSetupDocument(document)) setError(TEAMS_APP_STEPS.loadError)
        } catch (e) {
            setError(errorMessage(e, TEAMS_APP_STEPS.loadError))
        } finally {
            setDownloading(false)
        }
    }

    return (
        <div className="flex flex-col gap-5" data-testid="channels-teams-app">
            <div className="flex flex-col gap-2">
                <span className={TITLE}>{endpoint.title}</span>
                <p className={BODY}>{endpoint.body}</p>
                <CopyField
                    label={endpoint.label}
                    value={connection.webhookUrl ?? ""}
                    testId="channels-teams-endpoint"
                />
            </div>
            <div className="flex flex-col gap-2">
                <span className={TITLE}>{install.title}</span>
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
                        {install.download}
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
                <p className={BODY}>{install.upload}</p>
                <p className={BODY}>{install.noUpload}</p>
            </div>
        </div>
    )
}
