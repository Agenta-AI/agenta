import {IconProps} from "./types"

const Groq = ({...props}: IconProps) => {
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
                d="M16.0013 4C11.5891 4 8 7.58913 8 12.0009C8 16.4127 11.5891 20.0023 16.0013 20.0023H18.6327V17.0016H16.0013C13.2439 17.0016 11.0006 14.7584 11.0006 12.0009C11.0006 9.2434 13.2439 7.0002 16.0013 7.0002C18.7588 7.0002 21.0138 9.2434 21.0138 12.0009V19.3696C21.0138 22.1091 18.7831 24.3402 16.0504 24.369C14.7429 24.3582 13.4924 23.8327 12.5703 22.9056L10.4486 25.0273C11.9192 26.5055 13.9117 27.3467 15.9964 27.3691V27.3705C16.0144 27.3705 16.0324 27.3705 16.05 27.3705H16.1063V27.3691C20.4555 27.3102 23.9771 23.7647 23.9973 19.4057L24 11.8046C23.8955 7.48373 20.3474 4 16.0013 4Z"
                fill="black"
            />
        </svg>
    )
}

export default Groq
