import {ReactNode} from "react"

import {Button, Typography} from "antd"
import Image from "next/image"

const NoResultsFound = ({
    className,
    title,
    description,
    primaryActionLabel = "Create your first evaluator",
    onPrimaryAction,
    primaryActionSlot,
}: {
    className?: string
    title?: string
    description?: string
    primaryActionLabel?: string
    onPrimaryAction?: () => void
    /** Custom slot to render instead of the default primary action button */
    primaryActionSlot?: ReactNode
}) => {
    return (
        <div
            className={`w-full flex flex-col items-center justify-center py-20 gap-4 [&>span.ant-typography]:leading-[1.4] [&>span.ant-typography]:text-xl [&>span.ant-typography]:font-medium [&>span.ant-typography]:text-colorText ${className}`}
        >
            <Image src="/assets/not-found.png" alt="not-found" width={240} height={210} />
            <Typography.Text>{!title ? "No Results found" : title}</Typography.Text>
            <Typography.Paragraph type="secondary">
                {!description ? "No results match the search criteria." : description}
            </Typography.Paragraph>
            {primaryActionSlot
                ? primaryActionSlot
                : onPrimaryAction && (
                      <Button type="primary" onClick={onPrimaryAction}>
                          {primaryActionLabel}
                      </Button>
                  )}
        </div>
    )
}

export default NoResultsFound
