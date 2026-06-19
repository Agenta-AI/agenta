import {Spin} from "antd"

interface Props {
    text?: string
    containerProps?: React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>
    innerContainerProps?: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLDivElement>,
        HTMLDivElement
    >
    spinnerProps?: React.ComponentProps<typeof Spin>
}

const ContentSpinner: React.FC<Props> = ({
    text,
    containerProps,
    innerContainerProps,
    spinnerProps,
}) => {
    return (
        <div
            {...containerProps}
            className={`w-full h-full flex-1 grid place-items-center ${containerProps?.className || ""}`}
        >
            <div
                {...innerContainerProps}
                className={`inline-block text-center ${innerContainerProps?.className || ""}`}
            >
                <Spin {...spinnerProps} tip={text} />
            </div>
        </div>
    )
}

export default ContentSpinner
