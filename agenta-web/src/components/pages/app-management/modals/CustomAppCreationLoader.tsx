import React from "react"

const CustomAppCreationLoader = ({isFinish}: {isFinish: boolean}) => {
    return (
        <div className="loading-circle">
            <svg
                width="160"
                height="160"
                viewBox="0 0 160 160"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={`${isFinish && "*:!stroke-[#36cfc9] *:!shadow-[0px_0px_10px_0px_#B2F8FF]"}`}
            >
                <path
                    d="M77 140C62.0921 139.336 47.9729 133.117 37.4232 122.568C26.8734 112.018 20.6577 97.902 20 83"
                    stroke="#D6DEE6"
                />

                <path
                    d="M20 77C20.6632 62.0925 26.882 47.9737 37.4317 37.4239C47.9815 26.8742 62.0975 20.6582 77 20"
                    stroke="#36CFC9"
                    strokeWidth="2"
                />

                <path
                    d="M83 20C97.9073 20.663 112.026 26.8817 122.576 37.4314C133.126 47.9812 139.342 62.0974 140 77"
                    stroke="#D6DEE6"
                />
                <path
                    d="M140 83C139.337 97.9069 133.119 112.025 122.569 122.575C112.019 133.125 97.903 139.341 83 140"
                    stroke="#D6DEE6"
                />
                <defs>
                    <filter
                        id="filter0_d_3369_25826"
                        x="9.00098"
                        y="9.00098"
                        width="78.043"
                        height="78.0435"
                        filterUnits="userSpaceOnUse"
                        colorInterpolationFilters="sRGB"
                    >
                        <feFlood floodOpacity="0" result="BackgroundImageFix" />
                        <feColorMatrix
                            in="SourceAlpha"
                            type="matrix"
                            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                            result="hardAlpha"
                        />
                        <feOffset />
                        <feGaussianBlur stdDeviation="5" />
                        <feComposite in2="hardAlpha" operator="out" />
                        <feColorMatrix
                            type="matrix"
                            values="0 0 0 0 0.698039 0 0 0 0 0.972549 0 0 0 0 1 0 0 0 1 0"
                        />
                        <feBlend
                            mode="normal"
                            in2="BackgroundImageFix"
                            result="effect1_dropShadow_3369_25826"
                        />
                        <feBlend
                            mode="normal"
                            in="SourceGraphic"
                            in2="effect1_dropShadow_3369_25826"
                            result="shape"
                        />
                    </filter>
                </defs>
                {isFinish && (
                    <>
                        <mask
                            id="mask0_3369_25815"
                            className="mask-type:alpha"
                            maskUnits="userSpaceOnUse"
                            x="51"
                            y="59"
                            width="59"
                            height="42"
                        >
                            <path
                                d="M51.9999 81.5004L69.5587 99.0595L108.618 60"
                                stroke="white"
                                strokeWidth="2"
                            />
                        </mask>
                        <g mask="url(#mask0_3369_25815)">
                            <rect
                                x="40.9999"
                                y="41"
                                width="77.7436"
                                height="77.7436"
                                fill="#36CFC9"
                            />
                        </g>
                        <defs>
                            <filter
                                id="filter0_d_3369_25815"
                                x="9.00098"
                                y="72.9561"
                                width="78.0435"
                                height="78.043"
                                filterUnits="userSpaceOnUse"
                                colorInterpolationFilters="sRGB"
                            >
                                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                                <feColorMatrix
                                    in="SourceAlpha"
                                    type="matrix"
                                    values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                                    result="hardAlpha"
                                />
                                <feOffset />
                                <feGaussianBlur stdDeviation="5" />
                                <feComposite in2="hardAlpha" operator="out" />
                                <feColorMatrix
                                    type="matrix"
                                    values="0 0 0 0 0.698039 0 0 0 0 0.972549 0 0 0 0 1 0 0 0 1 0"
                                />
                                <feBlend
                                    mode="normal"
                                    in2="BackgroundImageFix"
                                    result="effect1_dropShadow_3369_25815"
                                />
                                <feBlend
                                    mode="normal"
                                    in="SourceGraphic"
                                    in2="effect1_dropShadow_3369_25815"
                                    result="shape"
                                />
                            </filter>
                            <filter
                                id="filter1_d_3369_25815"
                                x="9.00098"
                                y="9.00098"
                                width="78.0432"
                                height="78.0435"
                                filterUnits="userSpaceOnUse"
                                colorInterpolationFilters="sRGB"
                            >
                                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                                <feColorMatrix
                                    in="SourceAlpha"
                                    type="matrix"
                                    values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                                    result="hardAlpha"
                                />
                                <feOffset />
                                <feGaussianBlur stdDeviation="5" />
                                <feComposite in2="hardAlpha" operator="out" />
                                <feColorMatrix
                                    type="matrix"
                                    values="0 0 0 0 0.698039 0 0 0 0 0.972549 0 0 0 0 1 0 0 0 1 0"
                                />
                                <feBlend
                                    mode="normal"
                                    in2="BackgroundImageFix"
                                    result="effect1_dropShadow_3369_25815"
                                />
                                <feBlend
                                    mode="normal"
                                    in="SourceGraphic"
                                    in2="effect1_dropShadow_3369_25815"
                                    result="shape"
                                />
                            </filter>
                            <filter
                                id="filter2_d_3369_25815"
                                x="72.9561"
                                y="9.00098"
                                width="78.0435"
                                height="78.043"
                                filterUnits="userSpaceOnUse"
                                colorInterpolationFilters="sRGB"
                            >
                                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                                <feColorMatrix
                                    in="SourceAlpha"
                                    type="matrix"
                                    values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                                    result="hardAlpha"
                                />
                                <feOffset />
                                <feGaussianBlur stdDeviation="5" />
                                <feComposite in2="hardAlpha" operator="out" />
                                <feColorMatrix
                                    type="matrix"
                                    values="0 0 0 0 0.698039 0 0 0 0 0.972549 0 0 0 0 1 0 0 0 1 0"
                                />
                                <feBlend
                                    mode="normal"
                                    in2="BackgroundImageFix"
                                    result="effect1_dropShadow_3369_25815"
                                />
                                <feBlend
                                    mode="normal"
                                    in="SourceGraphic"
                                    in2="effect1_dropShadow_3369_25815"
                                    result="shape"
                                />
                            </filter>
                            <filter
                                id="filter3_d_3369_25815"
                                x="72.9561"
                                y="72.9561"
                                width="78.0435"
                                height="78.043"
                                filterUnits="userSpaceOnUse"
                                colorInterpolationFilters="sRGB"
                            >
                                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                                <feColorMatrix
                                    in="SourceAlpha"
                                    type="matrix"
                                    values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                                    result="hardAlpha"
                                />
                                <feOffset />
                                <feGaussianBlur stdDeviation="5" />
                                <feComposite in2="hardAlpha" operator="out" />
                                <feColorMatrix
                                    type="matrix"
                                    values="0 0 0 0 0.698039 0 0 0 0 0.972549 0 0 0 0 1 0 0 0 1 0"
                                />
                                <feBlend
                                    mode="normal"
                                    in2="BackgroundImageFix"
                                    result="effect1_dropShadow_3369_25815"
                                />
                                <feBlend
                                    mode="normal"
                                    in="SourceGraphic"
                                    in2="effect1_dropShadow_3369_25815"
                                    result="shape"
                                />
                            </filter>
                        </defs>
                    </>
                )}
            </svg>
        </div>
    )
}

export default CustomAppCreationLoader
