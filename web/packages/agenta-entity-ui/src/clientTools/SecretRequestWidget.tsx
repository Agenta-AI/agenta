import type {ClientToolWidgetProps} from "@agenta/shared/clientTools"

/** The step's sentence for a secret ask; the timeline node beside it wears the key. */
export const SecretRequestWidget = ({meta}: ClientToolWidgetProps) => {
    const input = meta.input as {name?: unknown} | undefined
    const output = meta.output as {status?: string; env_var?: unknown} | undefined
    const envVar = typeof output?.env_var === "string" ? output.env_var : undefined
    const asked = typeof input?.name === "string" ? input.name : undefined
    const name = <strong className="font-medium">{envVar ?? asked ?? "a secret"}</strong>
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
