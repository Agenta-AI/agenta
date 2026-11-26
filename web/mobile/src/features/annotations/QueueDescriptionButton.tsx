import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {Info} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

const ReadOnlyEditor = dynamic(() => import("./ReadOnlyEditor").then((m) => m.ReadOnlyEditor), {
    ssr: false,
})

/** The queue's instructions for annotators, as read-only markdown in a popover. */
export const QueueDescriptionButton = ({description}: {description: string}) => (
    <Popover>
        <PopoverTrigger asChild>
            <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Queue description"
                className="text-muted-foreground"
            >
                <Info aria-hidden size={14} />
            </Button>
        </PopoverTrigger>
        <PopoverContent
            align="start"
            className="max-h-[min(320px,calc(100dvh-160px))] w-[min(350px,calc(100vw-32px))] overflow-y-auto"
        >
            <ReadOnlyEditor id="annotation-panel-description" value={description} />
        </PopoverContent>
    </Popover>
)
