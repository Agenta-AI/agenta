import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {fetchCustomEvaluationDetail} from "@/lib/services/api"
import {useEffect, useState} from "react"
import CustomPythonCode from "@/components/Evaluations/CustomPythonCode"

type StyleProps = {
    themeMode: "dark" | "light"
}

interface ICustomEvalDetails {
    id: string
    evaluation_name: string
    app_name: string
    python_code: string
    created_at: string
    updated_at: string
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

export default function EditCustomEvaluation() {
    const router = useRouter()
    const appName = router.query.app_name?.toString() || ""
    const id: string = router.query.id?.toString() || ""
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [evalDetail, setEvalDetail] = useState<ICustomEvalDetails>()

    useEffect(() => {
        const evaluationDetails = async () => {
            const response: any = await fetchCustomEvaluationDetail(id)
            setEvalDetail(response)
        }
        evaluationDetails()
    }, [])

    return (
        <>
            {evalDetail?.evaluation_name !== undefined && evalDetail?.evaluation_name !== "" && (
                <CustomPythonCode
                    classes={classes}
                    appName={appName}
                    appTheme={appTheme}
                    editMode={true}
                    editCode={evalDetail?.python_code}
                    editName={evalDetail?.evaluation_name}
                    editId={id}
                />
            )}
        </>
    )
}
