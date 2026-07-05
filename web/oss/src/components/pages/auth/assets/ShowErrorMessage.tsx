import clsx from "clsx"

const ShowErrorMessage = ({info, className}: any) => {
    return (
        <div className={clsx("text-center mb-4", className)}>
            <span className="text-colorError font-medium">{info.message}</span>
            <div className="text-colorTextSecondary">{info.sub}</div>
        </div>
    )
}

export default ShowErrorMessage
