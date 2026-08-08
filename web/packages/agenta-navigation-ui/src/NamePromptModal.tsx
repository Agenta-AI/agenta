import {useEffect, useState} from "react"

import {EnhancedModal} from "@agenta/ui/components/modal"

export interface NamePromptModalProps {
    title: string
    label: string
    placeholder: string
    open: boolean
    onCancel: () => void
    onSubmit: (name: string) => void
    isPending?: boolean
    okText?: string
}

/** One-field create modal (project, organization): EnhancedModal + a plain input. */
export const NamePromptModal = ({
    title,
    label,
    placeholder,
    open,
    onCancel,
    onSubmit,
    isPending,
    okText = "Create",
}: NamePromptModalProps) => {
    const [name, setName] = useState("")
    const [touched, setTouched] = useState(false)
    useEffect(() => {
        if (!open) {
            setName("")
            setTouched(false)
        }
    }, [open])

    const submit = () => {
        setTouched(true)
        if (name.trim()) onSubmit(name.trim())
    }

    return (
        <EnhancedModal
            title={title}
            open={open}
            okText={okText}
            onCancel={onCancel}
            onOk={submit}
            confirmLoading={isPending}
            destroyOnHidden
            centered
        >
            <form
                className="flex flex-col gap-1 py-2"
                onSubmit={(event) => {
                    event.preventDefault()
                    submit()
                }}
            >
                <label className="text-xs text-colorTextSecondary">{label}</label>
                <input
                    autoFocus
                    value={name}
                    placeholder={placeholder}
                    onChange={(event) => setName(event.target.value)}
                    className="box-border h-8 w-full rounded-md border border-solid border-colorBorder bg-colorBgContainer px-2 text-[13px] text-colorText outline-none focus:border-colorPrimary"
                />
                {touched && !name.trim() ? (
                    <span className="text-xs text-colorError">{`Please enter a ${label.toLowerCase()}`}</span>
                ) : null}
            </form>
        </EnhancedModal>
    )
}
