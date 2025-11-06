import clsx from "clsx"
import type {PropsWithChildren} from "react"

type ReadOnlyBoxProps = PropsWithChildren<{className?: string}>

const ReadOnlyBox = ({children, className}: ReadOnlyBoxProps) => {
    return (
        <div
            className={clsx(
                "rounded-md border border-solid border-[#E4E7EC] bg-[#F8FAFC] px-3 py-2 leading-[20px] text-[#1D2939] whitespace-pre-wrap break-words",
                className,
            )}
        >
            {children}
        </div>
    )
}

export default ReadOnlyBox
