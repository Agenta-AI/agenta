import {useCallback, useRef, useState} from "react"

import {cn} from "@agenta/ui/styles"
import {Button} from "@agenta/ui/ui"
import {Table, Tray} from "@phosphor-icons/react"

export interface CreateTestsetCardProps {
    /** Called when a file is uploaded (CSV/JSON) */
    onFileUpload?: (file: File) => void
    /** Called when the 'Build in UI' button is clicked */
    onBuildInUI?: () => void
}

const ACCEPT = ".csv,.json"

export function CreateTestsetCard({onFileUpload, onBuildInUI}: CreateTestsetCardProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [over, setOver] = useState(false)
    const disabled = !onFileUpload

    const take = useCallback(
        (files: FileList | null) => {
            const file = files?.[0]
            if (file) onFileUpload?.(file)
        },
        [onFileUpload],
    )

    return (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-dashed border-colorBorder bg-colorFillQuaternary px-3 py-3">
            <span className="font-medium text-colorText">Create a new testset</span>

            <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                    if (disabled) return
                    e.preventDefault()
                    setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                    if (disabled) return
                    e.preventDefault()
                    setOver(false)
                    take(e.dataTransfer.files)
                }}
                className={cn(
                    // Load-bearing: preflight is off, so a bare <button> keeps the UA's
                    // 13.33px/normal. `font-[inherit]` only covers family — the size needs
                    // its own arbitrary property or the text renders a point too big.
                    "font-[inherit] [font-size:inherit] leading-normal",
                    // p-4 = antd's .ant-upload-btn padding (token.padding, 16px).
                    "rounded-xl border border-dashed border-colorBorder bg-colorBgContainer p-4 transition-colors",
                    !disabled && "hover:border-colorPrimary",
                    over && "border-colorPrimary bg-colorFillQuaternary",
                    disabled && "cursor-not-allowed opacity-60",
                )}
            >
                <div className="flex flex-col items-center justify-center gap-2 py-1">
                    <Tray size={20} className="text-colorTextDescription" />
                    <span className="leading-[20px] text-colorText">
                        Drop CSV/JSON here or click to browse
                    </span>
                </div>
            </button>

            <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                    take(e.target.files)
                    e.target.value = ""
                }}
            />

            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-colorTextDescription">
                <span className="h-px flex-1 bg-colorSplit" />
                <span>or</span>
                <span className="h-px flex-1 bg-colorSplit" />
            </div>

            <Button className="w-full" disabled={!onBuildInUI} onClick={onBuildInUI}>
                <Table size={16} weight="regular" />
                Build in UI
            </Button>
        </div>
    )
}
