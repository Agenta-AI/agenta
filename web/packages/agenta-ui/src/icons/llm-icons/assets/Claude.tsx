import {IconProps} from "./types"

/** The Claude mark: its spark of uneven rays, in its brand orange. */
const Claude = ({...props}: IconProps) => {
    return (
        <svg
            width="100%"
            height="100%"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <g stroke="#D97757" strokeWidth={2.4} strokeLinecap="round">
                <line x1="12.00" y1="9.80" x2="12.00" y2="1.50" />
                <line x1="13.23" y1="10.18" x2="17.03" y2="4.54" />
                <line x1="13.91" y1="10.90" x2="20.66" y2="7.00" />
                <line x1="14.19" y1="12.15" x2="20.48" y2="12.59" />
                <line x1="13.91" y1="13.10" x2="21.09" y2="17.25" />
                <line x1="12.96" y1="13.98" x2="16.16" y2="20.54" />
                <line x1="12.00" y1="14.20" x2="12.00" y2="22.00" />
                <line x1="10.77" y1="13.82" x2="7.25" y2="19.05" />
                <line x1="10.09" y1="13.10" x2="2.91" y2="17.25" />
                <line x1="9.81" y1="11.85" x2="3.02" y2="11.37" />
                <line x1="10.09" y1="10.90" x2="3.34" y2="7.00" />
                <line x1="11.04" y1="10.02" x2="7.84" y2="3.46" />
            </g>
        </svg>
    )
}

export default Claude
