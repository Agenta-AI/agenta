import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import CustomPythonCode from "@/components/Evaluations/CustomPythonCode"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    evaluationContainer: {
        border: "1px solid lightgrey",
        padding: "20px",
        borderRadius: "14px",
        marginBottom: 50,
    },
    evaluationImg: ({themeMode}: StyleProps) => ({
        width: 24,
        height: 24,
        marginRight: "8px",
        filter: themeMode === "dark" ? "invert(1)" : "none",
    }),
    customTitle: {
        marginBottom: "30px !important",
    },
    submitBtn: {
        marginTop: "30px",
        width: "250px",
    },
    levelFourHeading: {
        marginBottom: "15px",
    },
    copyBtn: {
        marginLeft: "15px",
    },
    modalError: {
        color: "red",
        marginLeft: "0px",
    },
})

export default function CreateCustomEvaluation() {
    const router = useRouter()
    const appId = router.query.app_id?.toString() || ""

    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)

    return <CustomPythonCode classes={classes} appId={appId} appTheme={appTheme} editMode={false} />
}
