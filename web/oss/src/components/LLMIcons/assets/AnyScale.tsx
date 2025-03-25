import {IconProps} from "./types"

const AnyScale = ({...props}: IconProps) => {
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
                d="M21.0353 16.3753L17.788 22.0001H24.3274C24.5675 22.0001 24.7897 21.8723 24.9109 21.6635L27.9641 16.3753H21.0353Z"
                fill="#4061FA"
            />
            <path
                d="M27.9641 15.6245L24.9109 10.3362C24.7907 10.1275 24.5686 9.99963 24.3274 9.99963H17.788L21.0353 15.6245H27.9641Z"
                fill="#4061FA"
            />
            <path
                d="M11.2934 9.99968H17.788L14.5183 4.33662C14.3982 4.12792 14.176 4 13.9348 4H7.82849L11.2923 9.99968H11.2934Z"
                fill="#4061FA"
            />
            <path
                d="M7.17932 4.37463L4.12618 9.66293C4.00612 9.87163 4.00612 10.1275 4.12618 10.3362L7.39587 15.9992L10.6431 10.3743L7.17932 4.37463Z"
                fill="#4061FA"
            />
            <path
                d="M10.6443 21.6242L7.397 15.9992L4.12618 21.6634C4.00612 21.8722 4.00612 22.1279 4.12618 22.3367L7.17932 27.625L10.6431 21.6254L10.6443 21.6242Z"
                fill="#4061FA"
            />
            <path
                d="M7.82849 28H13.9348C14.1749 28 14.3971 27.872 14.5183 27.6634L17.788 22.0002H11.2934L7.82962 28H7.82849Z"
                fill="#4061FA"
            />
        </svg>
    )
}

export default AnyScale
