import {PlaygroundComparisionPromptConfigProps} from "./typed"
import clsx from "clsx"

const PlaygroundComparisionPromptConfig: React.FC<PlaygroundComparisionPromptConfigProps> = ({
    className,
    children,
}) => {
    return (
        <div
            className={clsx(
                "[&::-webkit-scrollbar]:*:w-0 w-[400px] h-full overflow-y-auto *:!overflow-x-hidden",
                className,
            )}
        >
            {children}
        </div>
    )
}

export default PlaygroundComparisionPromptConfig
