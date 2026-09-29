import {type ShareError} from "@agenta/entities/drive"
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {Ban, History, Lock, LogIn, PauseCircle, Unlink, WifiOff, type LucideIcon} from "lucide-react"
import {useRouter} from "next/router"

import {rememberReturnPath} from "@/lib/context"

const COPY: Record<string, {title: string; description: string; icon: LucideIcon}> = {
    sign_in_required: {
        title: "Sign in to open this app",
        description: "This app is shared with the members of a workspace.",
        icon: LogIn,
    },
    not_a_member: {
        title: "You don't have access",
        description: "This app is shared with the members of a workspace you are not in.",
        icon: Lock,
    },
    share_unavailable: {
        title: "This app is paused",
        description: "Its session is archived. It opens again when the owner unarchives it.",
        icon: PauseCircle,
    },
    version_not_found: {
        title: "This version does not exist",
        description: "Open the link without a version to see the latest one.",
        icon: History,
    },
    sharing_disabled: {
        title: "Sharing is not available",
        description: "This Agenta deployment has sharing turned off.",
        icon: Ban,
    },
}

const NOT_FOUND = {
    title: "This link does not work",
    description: "The app may no longer be shared, or the link is incomplete.",
    icon: Unlink,
}

/** Every way a share link can fail, each with the one action that helps. */
export const SharedAppError = ({error, onRetry}: {error: ShareError | null; onRetry: () => void}) => {
    const router = useRouter()
    const code = error?.code ?? "unavailable"
    const copy =
        COPY[code] ??
        (code === "share_not_found"
            ? NOT_FOUND
            : {
                  title: "The app could not load",
                  description: "Check your connection and try again.",
                  icon: WifiOff,
              })
    const Icon = copy.icon

    return (
        <Empty className="flex-1">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Icon />
                </EmptyMedia>
                <EmptyTitle>{copy.title}</EmptyTitle>
                <EmptyDescription>{copy.description}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                {code === "sign_in_required" ? (
                    <Button
                        onClick={() => {
                            rememberReturnPath(router.asPath)
                            void router.push("/auth")
                        }}
                    >
                        Sign in
                    </Button>
                ) : code === "unavailable" ? (
                    <Button variant="outline" onClick={onRetry}>
                        Try again
                    </Button>
                ) : null}
            </EmptyContent>
        </Empty>
    )
}
