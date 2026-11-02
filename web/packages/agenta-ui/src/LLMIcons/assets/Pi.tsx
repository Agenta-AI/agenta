import {IconProps} from "./types"

/**
 * Interim Pi harness mark: an ink rounded square with a white italic π. Stands in until pi.dev
 * publishes a real logo asset, so it is drawn rather than traced from one.
 */
const Pi = ({...props}: IconProps) => {
    return (
        <svg
            width="100%"
            height="100%"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <rect width="32" height="32" rx="8" fill="#242424" />
            <text
                x="16"
                y="22"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="18"
                fontStyle="italic"
                fontFamily="Georgia, 'Times New Roman', serif"
            >
                π
            </text>
        </svg>
    )
}

export default Pi
