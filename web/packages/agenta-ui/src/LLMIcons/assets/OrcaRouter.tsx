import {IconProps} from "./types.d"

const OrcaRouter = ({...props}: IconProps) => {
    return (
        <svg
            width="100%"
            height="100%"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            {/* Orca dorsal fin silhouette */}
            <path
                d="M22.5 3.5C16.5 5 10.5 10.5 8.8 17.2C8.3 19.2 9.8 20.9 11.7 20.2C14.8 19.1 17.7 16.7 20.2 13.7C22.6 11 24.3 7.3 24.4 4.2C23.1 3.5 22.5 3.5 22.5 3.5Z"
                fill="#1f2937"
            />
            {/* White fin accent */}
            <path
                d="M12.6 11.2C14.2 9.2 16.2 7.5 18.5 6.4C16.6 8.8 13.7 11.6 11.2 13.6C11.7 12.8 12.1 12 12.6 11.2Z"
                fill="white"
            />
        </svg>
    )
}

export default OrcaRouter
