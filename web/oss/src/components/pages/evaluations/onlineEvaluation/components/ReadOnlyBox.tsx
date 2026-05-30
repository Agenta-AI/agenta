import type {PropsWithChildren} from "react"

import clsx from "clsx"

type ReadOnlyBoxProps = PropsWithChildren<{className?: string}>

const ReadOnlyBox = ({children, className}: ReadOnlyBoxProps) => {
    return (
        <div
            className={clsx(
                "rounded-md border border-solid border-[var(--ag-c-E4E7EC)] bg-[var(--ag-c-F8FAFC)] px-3 py-2 leading-[20px] text-[var(--ag-c-1D2939)] whitespace-pre-wrap break-words",
                className,
            )}
        >
            {children}
        </div>
    )
}

export default ReadOnlyBox
