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
import {Ban, Lock, LogIn, PauseCircle, Timer, Unlink, WifiOff, type LucideIcon} from "lucide-react"

import {useSignInAndReturn} from "@/features/auth/useSignInAndReturn"

interface Copy {
    title: string
    description: string
    icon: LucideIcon
    /** The same request can work later, so the page offers Try again. */
    retry?: boolean
}

const COPY: Record<string, Copy> = {
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
    share_not_found: {
        title: "This link does not work",
        description: "The app may no longer be shared, or the link is incomplete.",
        icon: Unlink,
    },
    rate_limited: {
        title: "This link is busy",
        description: "It was opened many times in a short time. Wait a minute and try again.",
        icon: Timer,
        retry: true,
    },
    sharing_disabled: {
        title: "Sharing is not available",
        description: "This Agenta deployment has sharing turned off.",
        icon: Ban,
    },
}

const UNAVAILABLE: Copy = {
    title: "The app could not load",
    description: "Check your connection and try again.",
    icon: WifiOff,
    retry: true,
}

/** Every way a share link can fail, each with the one action that helps. */
export const SharedAppError = ({
    error,
    onRetry,
}: {
    error: ShareError | null
    onRetry: () => void
}) => {
    const signIn = useSignInAndReturn()
    const code = error?.code ?? "unavailable"
    const copy = COPY[code] ?? UNAVAILABLE
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
                    <Button onClick={signIn}>Sign in</Button>
                ) : copy.retry ? (
                    <Button variant="outline" onClick={onRetry}>
                        Try again
                    </Button>
                ) : null}
            </EmptyContent>
        </Empty>
    )
}
