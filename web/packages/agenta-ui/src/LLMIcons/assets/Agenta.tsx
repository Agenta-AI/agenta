import {IconProps} from "./types"

/**
 * Agenta's own brand mark, for a connection Agenta provisioned — those are not any one vendor's,
 * so no vendor mark is honest for them.
 *
 * Traced from the sidebar's mark (`SidebarLogo`) rather than imported: that lives in
 * `@agenta/navigation-ui`, which sits above `@agenta/ui`. Same path, same theme accent, and the
 * same 171x140 viewBox — so it letterboxes inside a square icon box exactly as the rail's does.
 */
const Agenta = ({...props}: IconProps) => {
    return (
        <svg
            width="100%"
            height="100%"
            viewBox="0 0 171 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path
                className="fill-[#1E1C1D] dark:fill-[#F2F25C]"
                d="M115.504 95.9335C115.221 98.4384 116.607 99.1695 118.671 98.2233C124.787 95.4184 149.253 82.6572 162.347 82.6572C166.663 82.6572 184.04 84.7181 149.838 117.918C121.062 145.85 113.265 139.835 111.236 137.807C105.889 132.459 108.817 117.798 109.715 110.453C110.039 107.807 109.134 106.985 106.571 108.131C83.5096 118.441 40.4169 140 16.5021 140C-29.3433 140 33.8427 64.9164 43.6743 52.9651C76.3083 13.2951 97.3726 0 109.234 0C130.713 0 121.893 39.2078 115.504 95.9335Z"
            />
        </svg>
    )
}

export default Agenta
