import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import {envRevisionsAtom} from "@/oss/components/DeploymentsDashboard/atoms"
import {JSSTheme} from "@/oss/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
}))

const DrawerTitle = () => {
    const classes = useStyles()
    const env = useAtomValue(envRevisionsAtom)
    return <div className={`flex-1 ${classes.title}`}>{env?.name || ""}</div>
}

export default DrawerTitle
