import {useState, useRef} from "react"

export function CodeBlockErrorIndicator({errors}: {errors: string[]}) {
    const [hovering, setHovering] = useState(false)
    const ref = useRef<HTMLSpanElement>(null)

    return (
        <span
            ref={ref}
            className="absolute top-1 right-1 text-destructive cursor-help text-meta select-none"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            style={{
                userSelect: "none",
                WebkitUserSelect: "none",
                MozUserSelect: "none",
                msUserSelect: "none",
            }}
        >
            ⚠️
            {hovering && (
                <div className="absolute top-6 right-0 bg-popover border border-solid border-destructive/30 text-destructive text-meta px-3 py-2 rounded-lg shadow-overlay max-w-xs z-50">
                    <div className="space-y-1">
                        {errors.map((err, i) => (
                            <div className="whitespace-nowrap" key={i}>
                                • {err}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </span>
    )
}
