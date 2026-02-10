import {IconProps} from "./types"

const Azure = ({...props}: IconProps) => {
    return (
        <svg
            width="100%"
            height="100%"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path d="M4 4H15.4V15.4H4V4Z" fill="#F25022" />
            <path d="M16.6 4H28V15.4H16.6V4Z" fill="#80BA01" />
            <path d="M16.6 16.6H28V28H16.6V16.6Z" fill="#FFB902" />
            <path d="M4 16.6H15.4V28H4V16.6Z" fill="#02A4EF" />
        </svg>
    )
}

export default Azure
