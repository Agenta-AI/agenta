import {Button, Typography} from "antd"
import clsx from "clsx"
import PlaygroundComparisionGenerationInputHeader from "../assets/PlaygroundComparisionGenerationInputHeader"
import {useStyles} from "../styles"
import {Play} from "@phosphor-icons/react"

const PlaygroundComparisionCompletionInput = () => {
    const classes = useStyles()

    return (
        <div className={clsx("w-[400px] h-full overflow-y-auto *:!overflow-x-hidden")}>
            <PlaygroundComparisionGenerationInputHeader />
            <div className={clsx("w-full h-24 p-2 flex flex-col gap-2", classes.container)}>
                <Typography className="text-blue-600">country</Typography>
                <Typography className="px-2">Bangladesh</Typography>
            </div>
            <div className={clsx("w-ful h-[42px] p-2", classes.container)}>
                <Button size="small" icon={<Play size={14} />}>
                    Re-run
                </Button>
            </div>
        </div>
    )
}

export default PlaygroundComparisionCompletionInput
