import {IconProps} from "./types"

const Replicate = ({...props}: IconProps) => {
    return (
        <svg
            width="100%"
            height="100%"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M26 8.264V6H6V26H8.528V8.264H26ZM26 10.276V12.54H13.296V26H10.768V10.276H26ZM26 14.552V16.812H18.068V26H15.54V14.552H26Z"
                fill="black"
            />
        </svg>
    )
}

export default Replicate
