import GenericDrawer from "@/oss/components/GenericDrawer"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {memo, useCallback, useEffect} from "react"
import {focusScenarioAtom} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"

const FocusDrawerHeader = dynamic(() => import("./assets/FocusDrawerHeader"), {ssr: false})
const FocusDrawerContent = dynamic(() => import("./assets/FocusDrawerContent"), {ssr: false})
const FocusDrawerSidePanel = dynamic(() => import("./assets/FocusDrawerSidePanel"), {ssr: false})

const EvalRunFocusDrawer = () => {
    const router = useRouter()
    const [focusScenarioId, setFocusScenarioId] = useAtom(focusScenarioAtom)

    // Keep URL <-> atom in sync
    useEffect(() => {
        if (!router.isReady) return
        if (!focusScenarioId) return

        // URL lacks focus but atom has it -> write to URL
        if ((!router.query.focus && focusScenarioId) || router.query.focus !== focusScenarioId) {
            router.replace(
                {
                    pathname: router.pathname,
                    query: {...router.query, focus: focusScenarioId},
                },
                undefined,
                {shallow: true},
            )
            return
        }
    }, [focusScenarioId, router])

    // Keep URL <-> atom in sync
    useEffect(() => {
        if (!router.isReady) return
        if (!router.query.focus) return

        // URL has focus but atom doesn't -> write to atom
        if (router.query.focus && !focusScenarioId) {
            setFocusScenarioId(router.query.focus as string)
        }
    }, [router])

    const onClose = useCallback(() => {
        const {focus, ...rest} = router.query
        if (focus) {
            router.replace({pathname: router.pathname, query: {...rest}}, undefined, {
                shallow: true,
            })
        }
        setFocusScenarioId(null)
    }, [router, setFocusScenarioId])

    return (
        <GenericDrawer
            open={!!focusScenarioId}
            onClose={onClose}
            expandable
            headerExtra={<FocusDrawerHeader />}
            mainContent={<FocusDrawerContent />}
            sideContent={<FocusDrawerSidePanel />}
            className="[&_.ant-drawer-body]:p-0"
            sideContentDefaultSize={200}
        />
    )
}

export default memo(EvalRunFocusDrawer)
