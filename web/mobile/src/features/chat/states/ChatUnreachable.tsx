import {useT} from "@agenta/i18n"
import chatMobileScreenCatalog from "@agenta/i18n/catalogs/chat.mobileScreen"
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {CloudOff, RotateCw} from "lucide-react"

/** The session could not be read: a failed request, not a session with no agent or history. */
export const ChatUnreachable = ({onRetry, retrying}: {onRetry: () => void; retrying: boolean}) => {
    const t = useT(chatMobileScreenCatalog)
    return (
        <Empty className="m-auto py-16">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <CloudOff />
                </EmptyMedia>
                <EmptyTitle>{t("chat.mobileScreen.unreachableTitle")}</EmptyTitle>
                <EmptyDescription>{t("chat.mobileScreen.unreachableDescription")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
                    <RotateCw />
                    {t("chat.mobileScreen.tryAgain")}
                </Button>
            </EmptyContent>
        </Empty>
    )
}
