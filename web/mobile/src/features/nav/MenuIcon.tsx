import type {SVGProps} from "react"

/**
 * The menu glyph: a full bar over a shorter one. Drawn on Phosphor's 256 grid with its regular
 * stroke, so it sits with the other icons; Phosphor has no such pair.
 */
export const MenuIcon = (props: SVGProps<SVGSVGElement>) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        viewBox="0 0 256 256"
        fill="none"
        stroke="currentColor"
        strokeWidth={16}
        strokeLinecap="round"
        {...props}
    >
        <line x1="32" y1="96" x2="224" y2="96" />
        <line x1="32" y1="160" x2="144" y2="160" />
    </svg>
)
