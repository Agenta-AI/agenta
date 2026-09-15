import type {ClientToolWidgetProps} from "@agenta/shared/clientTools"

/** The step's sentence for a secret ask; the timeline node beside it wears the key. */
export const SecretRequestWidget = ({meta}: ClientToolWidgetProps) => {
    const input = meta.input as {name?: string} | undefined
    const output = meta.output as {status?: string; env_var?: string} | undefined
    const name = (
        <strong className="font-medium">{output?.env_var ?? input?.name ?? "a secret"}</strong>
    )
    return (
        <span className="text-sm text-colorText">
            {meta.settled ? (
                output?.status === "configured" ? (
                    <>You added {name}</>
                ) : (
                    <>You skipped {name}</>
                )
            ) : (
                <>Waiting for you to add {name} below</>
            )}
        </span>
    )
}
