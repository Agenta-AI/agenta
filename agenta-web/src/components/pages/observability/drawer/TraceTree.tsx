import {formatLatency} from "@/lib/helpers/formatters"
import {JSSTheme} from "@/lib/Types"
import {AgentaNodeDTO} from "@/services/observability/types"
import {Coins, PlusCircle, Timer, TreeStructure} from "@phosphor-icons/react"
import {Avatar, Space, Tree, TreeDataNode, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

interface TraceTreeProps {
    activeTrace: Record<string, AgentaNodeDTO>
    selectedKeys: string[]
    onSelect: (keys: React.Key[]) => void
    defaultSelectedTraceKey: string | undefined
}

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

const TreeContent = ({nodeValue}: {nodeValue: AgentaNodeDTO}) => {
    const {node, time} = nodeValue
    const classes = useStyles()

    return (
        <div className="py-[14px] px-2 flex items-center gap-2" key={node.id}>
            <Avatar
                shape="square"
                size={"large"}
                style={{backgroundColor: "#586673", width: 32}}
                icon={<TreeStructure size={16} />}
            />
            <div className="flex flex-col">
                <Typography.Text className={classes.treeTitle}>{node.name}</Typography.Text>
                <Space className={classes.treeContent}>
                    <div>
                        <Timer />
                        {formatLatency(time?.span / 1000000)}
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
    )
}

const buildTreeData = (
    nodes: Record<string, AgentaNodeDTO | AgentaNodeDTO[]>,
    expandedKeys: string[],
): TreeDataNode[] => {
    const createTreeNode = (node: AgentaNodeDTO): TreeDataNode => {
        const hasChildren = node.nodes && Object.keys(node.nodes).length > 0
        const key = node.node.id
        expandedKeys.push(key)

        return {
            key: key,
            title: <TreeContent nodeValue={node} />,
            children: hasChildren
                ? buildTreeData(
                      node.nodes as Record<string, AgentaNodeDTO | AgentaNodeDTO[]>,
                      expandedKeys,
                  )
                : undefined,
        }
    }

    return Object.entries(nodes).flatMap(([_, value]) => {
        if (Array.isArray(value)) {
            return value.map((item, index) =>
                createTreeNode({
                    ...item,
                    node: {...item.node, name: `${item.node.name}[${index}]`},
                }),
            )
        } else {
            return createTreeNode(value)
        }
    })
}

const TraceTree = ({
    activeTrace,
    selectedKeys,
    onSelect,
    defaultSelectedTraceKey,
}: TraceTreeProps) => {
    const classes = useStyles()
    const expandedKeys: string[] = []
    const treeData = buildTreeData(activeTrace, expandedKeys)

    return (
        <Tree
            showLine={{showLeafIcon: false}}
            showIcon={false}
            treeData={treeData}
            className={classes.tree}
            defaultExpandAll
            onSelect={onSelect}
            defaultExpandParent
            expandedKeys={expandedKeys}
            selectedKeys={selectedKeys}
        />
    )
}

export default TraceTree
