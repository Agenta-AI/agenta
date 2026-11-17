import {useState} from "react"

import {KEY_PROVIDERS} from "@agenta/entity-ui/secretProvider"
import {useT} from "@agenta/i18n"
import keyFormCatalog from "@agenta/i18n/catalogs/onboarding.keyForm"
import {Button} from "@agenta/ui/ui"
import {Check, Key} from "@phosphor-icons/react"
import {AnimatePresence, motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"

import {OnboardingKeyForm} from "./OnboardingKeyForm"
import {OnboardingWayRow} from "./OnboardingWayRow"
import type {OnboardingModel} from "./useOnboardingModel"

const PILL =
    "bg-success-bg text-success inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-xs font-medium leading-4"
const ACTION = "h-7 rounded-md px-2.5 text-xs font-medium"
/** The three providers the hint names before counting the rest. */
const NAMED_IN_HINT = 3

type RowState = {mode: "closed"} | {mode: "open"} | {mode: "saved"; tag: string}

/** The "Your API key" way to pay: opens in place to add a key, then shows the saved one. */
export const OnboardingKeyRow = ({keys, delay}: {keys: OnboardingModel["keys"]; delay: number}) => {
    const t = useT(keyFormCatalog)
    const presets = useMotionPresets()
    const [row, setRow] = useState<RowState>({mode: "closed"})

    const hint =
        row.mode === "saved"
            ? t("onboarding.keyForm.saved")
            : keys.connections.length > 0
              ? keys.connections.length > 1
                  ? t("onboarding.keyForm.usingMore", {
                        name: keys.connections[0].name,
                        more: keys.connections.length - 1,
                    })
                  : t("onboarding.keyForm.using", {name: keys.connections[0].name})
              : t("onboarding.keyForm.hint", {
                    more: Math.max(0, KEY_PROVIDERS.length - NAMED_IN_HINT),
                })

    const action =
        row.mode === "open" ? (
            <Button
                variant="ghost"
                className={`${ACTION} text-muted-foreground`}
                onClick={() => setRow({mode: "closed"})}
            >
                {t("onboarding.keyForm.cancel")}
            </Button>
        ) : row.mode === "saved" ? (
            <motion.span
                variants={presets.pop}
                initial="initial"
                animate="animate"
                className={PILL}
            >
                <Check size={11} weight="bold" />
                {row.tag}
            </motion.span>
        ) : (
            <Button variant="outline" className={ACTION} onClick={() => setRow({mode: "open"})}>
                {t("onboarding.keyForm.add")}
            </Button>
        )

    return (
        <OnboardingWayRow
            delay={delay}
            icon={<Key size={15} />}
            title={t("onboarding.keyForm.title")}
            hint={hint}
            action={action}
        >
            <AnimatePresence initial={false}>
                {row.mode === "open" ? (
                    <motion.div
                        key="form"
                        variants={presets.expand}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="-mx-1 -mt-1 overflow-hidden px-1 pt-1"
                    >
                        <OnboardingKeyForm
                            onSaved={(saved) => {
                                setRow({
                                    mode: "saved",
                                    tag: `${saved.provider} ••••${saved.last4}`,
                                })
                                keys.onSaved(saved.connectionId ?? undefined)
                            }}
                        />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </OnboardingWayRow>
    )
}
