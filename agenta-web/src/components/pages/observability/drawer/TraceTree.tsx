import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import {JSSTheme} from "@/lib/Types"
import {_AgentaRootsResponse, NodeStatusCode} from "@/services/observability/types"
import {Coins, PlusCircle, Timer} from "@phosphor-icons/react"
import {Space, Tree, Typography} from "antd"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import AvatarTreeContent from "../components/AvatarTreeContent"

interface TraceTreeProps {
    activeTrace: _AgentaRootsResponse
    selected: string
    setSelected: React.Dispatch<React.SetStateAction<string>>
}

interface NodeTreeChildren {
    title: React.ReactElement
    key: string
    children?: NodeTreeChildren[]
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    tree: {
        overflowY: "auto",
        height: "100%",
        padding: "1px 0",
        "& .ant-tree-node-content-wrapper": {
            minWidth: 240,
            marginTop: 6,
            marginBottom: 6,
        },
        "& .ant-tree-node-selected": {
            outline: `1px solid ${theme.colorBorder}`,
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
        "& .ant-tree-switcher-line-icon": {
            height: "100%",
        },
        "& .ant-tree-switcher:before": {
            top: "34%",
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
    treeContentContainer: {
        color: theme.colorTextSecondary,
        "& div": {
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: theme.fontSize,
        },
    },
    treeContent: {
        display: "flex",
        alignItems: "center",
        fontFamily: "monospace",
        gap: 2,
    },
}))

const TreeContent = ({value}: {value: _AgentaRootsResponse}) => {
    const {node, metrics, status} = value
    const classes = useStyles()

    return (
        <div className="py-[14px] px-2 flex items-center gap-2" key={node.id}>
            <div className="w-8">
                <AvatarTreeContent value={value} />
            </div>
            <div className="flex flex-col flex-1">
                <Typography.Text
                    className={
                        status.code === NodeStatusCode.ERROR
                            ? `${classes.treeTitle} text-[#D61010] font-[500]`
                            : classes.treeTitle
                    }
                >
                    {node.name}
                </Typography.Text>
                <Space className={classes.treeContentContainer}>
                    <div className={classes.treeContent}>
                        <Timer />
                        {formatLatency(
                            metrics?.acc?.duration?.total
                                ? metrics?.acc?.duration?.total / 1000
                                : null,
                        )}
                    </div>

                    {metrics?.acc?.costs?.total && (
                        <div className={classes.treeContent}>
                            <Coins />
                            {formatCurrency(metrics?.acc?.costs?.total)}
                        </div>
                    )}

                    {!!metrics?.acc?.tokens?.total && (
                        <div className={classes.treeContent}>
                            <PlusCircle />
                            {formatTokenUsage(metrics?.acc?.tokens?.total)}
                        </div>
                    )}
                </Space>
            </div>
        </div>
    )
}

const buildTreeData = (spans: _AgentaRootsResponse[]): NodeTreeChildren[] => {
    return spans.map((span) => ({
        title: <TreeContent value={span} />,
        key: span.node.id,
        children: span.children ? buildTreeData(span.children) : undefined,
    }))
}

const TraceTree = ({activeTrace, selected, setSelected}: TraceTreeProps) => {
    const classes = useStyles()
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])

    useEffect(() => {
        const initialExpandedKeys = getAllKeys(activeTrace)
        setExpandedKeys(initialExpandedKeys)
    }, [activeTrace])

    const getAllKeys = (node: _AgentaRootsResponse): string[] => {
        const childrenKeys = node.children ? node.children.flatMap(getAllKeys) : []
        return [node.node.id, ...childrenKeys]
    }

    const onExpand = (expanded: React.Key[]) => {
        setExpandedKeys(expanded)
    }

    return (
        <Tree
            showLine={activeTrace?.children ? true : false}
            selectedKeys={[selected]}
            expandedKeys={expandedKeys}
            onExpand={onExpand}
            showIcon={true}
            onSelect={(keys) => {
                if (keys.length > 0) {
                    setSelected(keys[0].toString() || activeTrace.node.id)
                }
            }}
            treeData={[
                {
                    title: <TreeContent value={activeTrace} />,
                    key: activeTrace.node.id,
                    children: activeTrace.children
                        ? buildTreeData(activeTrace.children)
                        : undefined,
                },
            ]}
            className={classes.tree}
            defaultExpandAll
            defaultExpandParent
        />
    )
}

export default TraceTree
