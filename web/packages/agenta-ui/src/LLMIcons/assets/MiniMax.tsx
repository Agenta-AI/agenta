import {IconProps} from "./types"

const MiniMax = ({...props}: IconProps) => {
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
                d="M4 8L8.8 24H10.4L14.4 12L18.4 24H20L24.8 8H22.4L19.2 20L15.2 8H13.6L9.6 20L6.4 8H4Z"
                fill="#1A1A1A"
            />
            <path
                d="M24 8L28 16L24 24H26.4L30.4 16L26.4 8H24Z"
                fill="#6366F1"
            />
        </svg>
    )
}

export default MiniMax
