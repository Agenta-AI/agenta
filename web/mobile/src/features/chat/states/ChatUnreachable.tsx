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
export const ChatUnreachable = ({onRetry, retrying}: {onRetry: () => void; retrying: boolean}) => (
    <Empty className="m-auto py-16">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <CloudOff />
            </EmptyMedia>
            <EmptyTitle>Couldn&apos;t load this session</EmptyTitle>
            <EmptyDescription>
                The server didn&apos;t respond. Check your connection, then try again.
            </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
            <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
                <RotateCw />
                Try again
            </Button>
        </EmptyContent>
    </Empty>
)
