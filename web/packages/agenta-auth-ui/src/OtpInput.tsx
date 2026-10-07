import {
    forwardRef,
    useImperativeHandle,
    useRef,
    type ClipboardEvent,
    type KeyboardEvent,
} from "react"

import {Input, cn} from "@agenta/ui/ui"

export interface OtpInputHandle {
    focus: () => void
}

/**
 * Six one-character cells over one string value (antd `Input.OTP` replacement, plain
 * elements). Paste fills from the first cell; typing advances; Backspace walks back.
 */
export const OtpInput = forwardRef<
    OtpInputHandle,
    {
        value: string
        onChange: (value: string) => void
        length?: number
        error?: boolean
        /** Dims the cells while the code is checked, then rings them green once it passes. */
        status?: "verifying" | "verified"
        autoFocus?: boolean
        disabled?: boolean
    }
>(({value, onChange, length = 6, error, status, autoFocus, disabled}, ref) => {
    const cellsRef = useRef<(HTMLInputElement | null)[]>([])
    const focusCell = (index: number) =>
        cellsRef.current[Math.max(0, Math.min(index, length - 1))]?.focus()

    useImperativeHandle(ref, () => ({focus: () => focusCell(value.length)}), [value.length])

    const setChars = (chars: string) => onChange(chars.toUpperCase().slice(0, length))

    const handleChange = (index: number, char: string) => {
        const clean = char.replace(/\s/g, "")
        if (!clean) return
        const next = (value.slice(0, index) + clean + value.slice(index + 1)).slice(0, length)
        setChars(next)
        focusCell(index + clean.length)
    }

    const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Backspace") {
            event.preventDefault()
            const cut = index >= value.length ? value.length - 1 : index
            if (cut < 0) return
            // Delete the one character under the caret and pull the rest left — the
            // value is a compact string, so truncating here would drop what follows.
            setChars(value.slice(0, cut) + value.slice(cut + 1))
            focusCell(cut)
        }
        if (event.key === "ArrowLeft") focusCell(index - 1)
        if (event.key === "ArrowRight") focusCell(index + 1)
    }

    const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
        event.preventDefault()
        setChars(event.clipboardData.getData("text"))
        focusCell(length - 1)
    }

    return (
        <div className="flex w-full gap-2" role="group" aria-label="One-time code">
            {Array.from({length}, (_, index) => (
                <Input
                    key={index}
                    ref={(el) => {
                        cellsRef.current[index] = el
                    }}
                    aria-label={`Character ${index + 1}`}
                    aria-invalid={error || undefined}
                    size="lg"
                    className={cn(
                        "h-[52px] min-w-0 flex-1 rounded-lg px-0 text-center text-xl font-medium uppercase transition-[border-color,box-shadow,opacity] md:text-xl",
                        value[index] && "auth-otp-pop border-ring",
                        status === "verifying" && "opacity-60",
                        status === "verified" && "border-success",
                    )}
                    inputMode="text"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    autoFocus={autoFocus && index === 0}
                    maxLength={length}
                    disabled={disabled}
                    value={value[index] ?? ""}
                    onChange={(event) => handleChange(index, event.target.value)}
                    onKeyDown={(event) => handleKeyDown(index, event)}
                    onPaste={handlePaste}
                    onFocus={(event) => event.target.select()}
                />
            ))}
        </div>
    )
})
OtpInput.displayName = "OtpInput"
