import {Button, Card, Tag, Typography} from "antd"
import {createUseStyles} from "react-jss"

type StylesProp = {
    tag: string | undefined
}

const {Text} = Typography

const useStyles = createUseStyles({
    card: {
        "& .ant-card-body": {
            padding: "1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-evenly",
            flexDirection: "column",
            position: "relative",
        },
    },
    tag: {
        position: "absolute",
        right: 0,
        top: 8,
    },
    text1: ({tag}: StylesProp) => ({
        marginBottom: -4,
        marginTop: tag ? 20 : 0,
        fontSize: 15,
    }),
    link: {
        textAlign: "center",
    },
    createBtn: {
        width: "100%",
    },
})

interface Props {
    title: string
    onClick: () => void
    body: string
    noTemplate: boolean
    tag?: string
}

const AppTemplateCard: React.FC<Props> = ({title, tag, onClick, body, noTemplate}) => {
    const classes = useStyles({tag} as StylesProp)
    return (
        <Card className={classes.card}>
            {tag && (
                <Tag color="blue" className={classes.tag}>
                    {tag}
                </Tag>
            )}
            <Text strong className={classes.text1}>
                {title}
            </Text>

            {noTemplate ? (
                <Text type="secondary" className={classes.link}>
                    <p>
                        {body} <a href="https://github.com/Agenta-AI/agenta/issues/new">here</a>.
                    </p>
                </Text>
            ) : (
                <div>
                    <Text type="secondary">
                        <p>{body}</p>
                    </Text>
                    <Button
                        shape="round"
                        onClick={onClick}
                        className={classes.createBtn}
                        data-cy="create-app-button"
                    >
                        Create App
                    </Button>
                </div>
            )}
        </Card>
    )
}

export default AppTemplateCard
