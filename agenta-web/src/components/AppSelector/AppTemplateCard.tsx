import {Button, Card, Tag, Typography} from "antd"

const {Text} = Typography

interface Props {
    title: string
    onClick: () => void
    body: string
    noTemplate: boolean
    tag?: string
}

const AppTemplateCard: React.FC<Props> = ({title, tag, onClick, body, noTemplate}) => {
    return (
        <Card
            bodyStyle={{
                padding: "1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-evenly",
                flexDirection: "column",
                position: "relative",
            }}
        >
            {tag && (
                <Tag color="blue" style={{position: "absolute", right: 0, top: 8}}>
                    {tag}
                </Tag>
            )}
            <Text strong style={{marginBottom: -4, marginTop: tag ? 20 : 0, fontSize: 15}}>
                {title}
            </Text>

            {noTemplate ? (
                <Text type="secondary" style={{textAlign: "center"}}>
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
                        style={{
                            width: "100%",
                        }}
                    >
                        Create App
                    </Button>
                </div>
            )}
        </Card>
    )
}

export default AppTemplateCard
