import {useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {ScratchTestsetStep} from "./ScratchTestsetStep"
import {UploadTestsetStep} from "./UploadTestsetStep"

// The snippets live in a large package; load them only when a reader opens this step.
const ApiTestsetStep = dynamic(() => import("./ApiTestsetStep").then((m) => m.ApiTestsetStep), {
    ssr: false,
})

type Step = "choose" | "scratch" | "api"

const HEADINGS: Record<Step, {title: string; description: string}> = {
    choose: {title: "Create new test set", description: "Upload a CSV or JSON file."},
    scratch: {
        title: "Create from scratch",
        description: "Create a new test set directly from the web UI",
    },
    api: {
        title: "Create a test set with API",
        description: "Create a test set programmatically using our API endpoints",
    },
}

/**
 * Create a test set: from a file, from scratch or with the API. The host mounts it only while it
 * is open, so closing it clears the step, the file and the name.
 */
export const CreateTestsetDialog = ({
    projectId,
    base,
    onClose,
}: {
    projectId: string
    base: string
    onClose: () => void
}) => {
    const [step, setStep] = useState<Step>("choose")
    const heading = HEADINGS[step]

    return (
        <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <div className="flex items-center gap-1">
                        {step === "choose" ? null : (
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Back"
                                onClick={() => setStep("choose")}
                            >
                                <ArrowLeft aria-hidden size={14} />
                            </Button>
                        )}
                        <DialogTitle>{heading.title}</DialogTitle>
                    </div>
                    <DialogDescription className={step === "choose" ? "sr-only" : undefined}>
                        {heading.description}
                    </DialogDescription>
                </DialogHeader>
                {step === "choose" ? (
                    <UploadTestsetStep
                        projectId={projectId}
                        base={base}
                        onClose={onClose}
                        onScratch={() => setStep("scratch")}
                        onApi={() => setStep("api")}
                    />
                ) : null}
                {step === "scratch" ? <ScratchTestsetStep base={base} onClose={onClose} /> : null}
                {step === "api" ? <ApiTestsetStep onClose={onClose} /> : null}
            </DialogContent>
        </Dialog>
    )
}
