import {JSSTheme} from "@/lib/Types"
import {
    Coins,
    Database,
    Download,
    FileArrowDown,
    ListChecks,
    PlusCircle,
    Sparkle,
    Timer,
    TreeStructure,
} from "@phosphor-icons/react"
import {Avatar, Space, Tree, TreeDataNode, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    tree: {
        overflowY: "auto",
        height: "100%",
        "& .ant-tree-node-content-wrapper": {
            width: 240,
        },
        "& .ant-tree-node-selected": {
            border: `1px solid ${theme.colorBorder}`,
        },
        "& .ant-tree-switcher-leaf-line": {
            "&:after": {
                height: "36px !important",
                width: 13,
            },
        },
        "& .ant-tree-treenode-leaf-last .ant-tree-switcher-leaf-line:before": {
            height: "36px !important",
        },
    },
    treeTitle: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        overflow: "hidden",
        height: "100%",
        width: "calc(210px - 40px)",
    },
    treeContent: {
        color: theme.colorTextSecondary,
        "& div": {
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: theme.fontSize,
        },
    },
}))

const TraceTree = () => {
    const classes = useStyles()

    const treeData: TreeDataNode[] = [
        {
            title: (
                <div className="py-[14px] px-2 flex items-center gap-2">
                    <Avatar
                        shape="square"
                        size={"large"}
                        style={{backgroundColor: "#586673", width: 32}}
                        icon={<TreeStructure size={16} />}
                    />
                    <div className="flex flex-col">
                        <Typography.Text className={classes.treeTitle}>Root trace</Typography.Text>
                        <Space className={classes.treeContent}>
                            <div>
                                <Timer />
                                983ms
                            </div>
                            <div>
                                <Coins />
                                $0.002
                            </div>
                            <div>
                                <PlusCircle />
                                72
                            </div>
                        </Space>
                    </div>
                </div>
            ),
            key: "0-0",
            children: [
                {
                    title: (
                        <div className="py-[14px] px-2 flex items-center gap-2">
                            <Avatar
                                shape="square"
                                size={"large"}
                                style={{backgroundColor: "#D6DEE6", width: 32}}
                                icon={<FileArrowDown size={16} />}
                            />
                            <div className="flex flex-col">
                                <Typography.Text className={classes.treeTitle}>
                                    Retrieval
                                </Typography.Text>
                                <Space className={classes.treeContent}>
                                    <div>
                                        <Timer />
                                        983ms
                                    </div>
                                    <div>
                                        <Coins />
                                        $0.002
                                    </div>
                                    <div>
                                        <PlusCircle />
                                        72
                                    </div>
                                </Space>
                            </div>
                        </div>
                    ),
                    key: "0-0-1-0",
                },
                {
                    title: (
                        <div className="py-[14px] px-2 flex items-center gap-2">
                            <Avatar
                                shape="square"
                                size={"large"}
                                style={{backgroundColor: "#69B1FF", width: 32}}
                                icon={<Database size={16} />}
                            />
                            <div className="flex flex-col">
                                <Typography.Text className={classes.treeTitle}>
                                    vector-store
                                </Typography.Text>
                                <Space className={classes.treeContent}>
                                    <div>
                                        <Timer />
                                        983ms
                                    </div>
                                    <div>
                                        <Coins />
                                        $0.002
                                    </div>
                                    <div>
                                        <PlusCircle />
                                        72
                                    </div>
                                </Space>
                            </div>
                        </div>
                    ),
                    key: "0-0-1-1",
                },
                {
                    title: (
                        <div className="py-[14px] px-2 flex items-center gap-2">
                            <Avatar
                                shape="square"
                                size={"large"}
                                style={{backgroundColor: "#87E8DE", width: 32}}
                                icon={<Sparkle size={16} />}
                            />
                            <div className="flex flex-col">
                                <Typography.Text className={classes.treeTitle}>
                                    prompt-embedding
                                </Typography.Text>
                                <Space className={classes.treeContent}>
                                    <div>
                                        <Timer />
                                        983ms
                                    </div>
                                    <div>
                                        <Coins />
                                        $0.002
                                    </div>
                                    <div>
                                        <PlusCircle />
                                        72
                                    </div>
                                </Space>
                            </div>
                        </div>
                    ),
                    key: "0-0-1-2",
                },
                {
                    title: (
                        <div className="py-[14px] px-2 flex items-center gap-2">
                            <Avatar
                                shape="square"
                                size={"large"}
                                style={{backgroundColor: "#FFD591", width: 32}}
                                icon={<ListChecks size={16} />}
                            />
                            <div className="flex flex-col">
                                <Typography.Text className={classes.treeTitle}>
                                    context-encoding
                                </Typography.Text>
                                <Space className={classes.treeContent}>
                                    <div>
                                        <Timer />
                                        983ms
                                    </div>
                                    <div>
                                        <Coins />
                                        $0.002
                                    </div>
                                    <div>
                                        <PlusCircle />
                                        72
                                    </div>
                                </Space>
                            </div>
                        </div>
                    ),
                    key: "0-0-1-3",
                },
            ],
        },
        {
            title: (
                <div className="py-[14px] px-2 flex items-center gap-2">
                    <Avatar
                        shape="square"
                        size={"large"}
                        style={{backgroundColor: "#D3ADF7", width: 32}}
                        icon={<Download size={16} />}
                    />
                    <div className="flex flex-col">
                        <Typography.Text className={classes.treeTitle}>
                            fetch-prompt-from-langfuse dendeinde deindeindeiw dwidnwndienw
                        </Typography.Text>
                        <Space className={classes.treeContent}>
                            <div>
                                <Timer />
                                983ms
                            </div>
                            <div>
                                <Coins />
                                $0.002
                            </div>
                            <div>
                                <PlusCircle />
                                72
                            </div>
                        </Space>
                    </div>
                </div>
            ),
            key: "0-1",
        },
        {
            title: (
                <div className="py-[14px] px-2 flex items-center gap-2">
                    <Avatar
                        shape="square"
                        size={"large"}
                        style={{backgroundColor: "#87E8DE", width: 32}}
                        icon={<Sparkle size={16} />}
                    />
                    <div className="flex flex-col">
                        <Typography.Text className={classes.treeTitle}>generation</Typography.Text>
                        <Space className={classes.treeContent}>
                            <div>
                                <Timer />
                                983ms
                            </div>
                            <div>
                                <Coins />
                                $0.002
                            </div>
                            <div>
                                <PlusCircle />
                                72
                            </div>
                        </Space>
                    </div>
                </div>
            ),
            key: "0-2",
        },
    ]

    return (
        <Tree
            showLine={{showLeafIcon: false}}
            showIcon={false}
            defaultExpandedKeys={["0-0-0"]}
            treeData={treeData}
            className={classes.tree}
            defaultExpandAll
            defaultSelectedKeys={["0-2"]}
        />
    )
}

export default TraceTree
