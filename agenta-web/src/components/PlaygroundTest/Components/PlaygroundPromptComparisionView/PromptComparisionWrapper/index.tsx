import {PromptComparisionWrapperProps} from "./typed"
import clsx from "clsx"

const PromptComparisionWrapper: React.FC<PromptComparisionWrapperProps> = ({
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

export default PromptComparisionWrapper
