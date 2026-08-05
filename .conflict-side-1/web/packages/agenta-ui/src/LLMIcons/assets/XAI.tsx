import {IconProps} from "./types"

const XAI = ({...props}: IconProps) => {
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
                d="M16.4453 18.8816L26.6383 4.32446H21.7121L13.9826 15.3641L16.4453 18.8816Z"
                fill="black"
            />
            <path
                d="M10.2879 27.6756L12.751 24.158L10.2879 20.6405L5.36169 27.6756H10.2879Z"
                fill="black"
            />
            <path
                d="M16.4453 27.6757H21.3715L10.2879 11.8462H5.36169L16.4453 27.6757Z"
                fill="black"
            />
            <path
                d="M26.6383 6.08337L22.6031 11.8461L23.0066 27.6756H26.2348L26.6383 6.08337Z"
                fill="black"
            />
        </svg>
    )
}

export default XAI
