import {useState, useRef} from "react"

export function CodeBlockErrorIndicator({errors}: {errors: string[]}) {
    const [hovering, setHovering] = useState(false)
    const ref = useRef<HTMLSpanElement>(null)

    return (
        <span
            ref={ref}
            className="absolute top-1 right-1 text-red-600 cursor-help text-xs"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            ⚠️
            {hovering && (
                <div className="absolute top-6 right-0 bg-red-50 border border-red-300 text-red-700 text-[0.625rem] leading-[0.75rem] px-3 py-2 rounded shadow-lg max-w-xs z-50">
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
