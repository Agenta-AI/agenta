import {IconProps} from "./types"

const Anthropic = ({...props}: IconProps) => {
    return (
        <svg
            width="100%"
            height="100%"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path d="M18.1314 6.66663L25.7965 25.9758H30L22.3349 6.66663H18.1314Z" fill="black" />
            <path
                d="M9.23873 18.3349L11.8615 11.5491L14.4843 18.3349H9.23873ZM9.66393 6.66663L2 25.9758H6.28523L7.8526 21.9208H15.8707L17.4378 25.9758H21.7231L14.0591 6.66663H9.66393Z"
                fill="black"
            />
        </svg>
    )
}

export default Anthropic
