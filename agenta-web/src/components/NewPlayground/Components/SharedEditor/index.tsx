import clsx from "clsx"
import React from "react"
import {BaseContainerProps} from "../types"

interface SharedEditorProps extends BaseContainerProps {
    header: React.ReactNode
    footer: React.ReactNode
    editorType?: "border" | "borderless"
    state?: "default" | "filled" | "disabled" | "readOnly" | "focus" | "typing"
}

const SharedEditor = ({
    header,
    footer,
    editorType = "borderless",
    state = "filled",
    ...props
}: SharedEditorProps) => {
    return (
        <div
            className={clsx(
                "w-full flex flex-col items-start gap-2 relative group/item transition-all duration-300 ease-in-out p-[11px] border border-solid border-[#BDC7D1] rounded-lg",
                editorType === "border" &&
                    `
                    hover:border-[#394857] focus:border-[#1C2C3D] box-shadow-[0px 0px 0px 2px rgba(5,23,41,0.10)]
                    ${state === "readOnly" && "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none"}
                    ${state === "disabled" && "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none"}
                    ${state === "filled" && "hover:border-[transparent] focus:border-[transparent]"}

                    `,
                editorType === "borderless" &&
                    `
                    border-[transparent] hover:border-[#394857] focus:border-[#1C2C3D] box-shadow-[0px 0px 0px 2px rgba(5,23,41,0.10)]
                    ${state === "readOnly" && "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none"}
                    ${state === "disabled" && "cursor-not-allowed bg-[rgba(5,23,41,0.04)] border-none"}
                    ${state === "filled" && "hover:border-[transparent] focus:border-[transparent]"}
                    `,
                props.className,
            )}
            {...props}
        >
            {header}
            {footer}
        </div>
    )
}

export default SharedEditor
