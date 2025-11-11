import {cloneElement, isValidElement, memo, MouseEvent, useState} from "react"

import {ArrowSquareOut, Database} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"

import {SaveDataButtonProps} from "./types"

const SaveDataModal = dynamic(() => import(".."), {ssr: false})

const SaveDataButton = ({
    name,
    rows,
    exportDataset = false,
    icon = true,
    children,
    label,
    onClick,
    ...props
}: SaveDataButtonProps) => {
    const [isModalOpen, setIsModalOpen] = useState(false)

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: (e: MouseEvent<HTMLElement>) => void
                    }>,
                    {
                        onClick: (e) => {
                            onClick?.(e)
                            setIsModalOpen(true)
                        },
                    },
                )
            ) : (
                <EnhancedButton
                    type="default"
                    icon={
                        icon &&
                        (exportDataset ? <ArrowSquareOut size={14} /> : <Database size={14} />)
                    }
                    onClick={async (e) => {
                        await onClick?.(e)
                        setIsModalOpen(true)
                    }}
                    label={label}
                    {...props}
                />
            )}

            <SaveDataModal
                name={name}
                rows={rows}
                exportDataset={exportDataset}
                open={isModalOpen && !!rows.length}
                onCancel={() => setIsModalOpen(false)}
            />
        </>
    )
}

export default memo(SaveDataButton)
