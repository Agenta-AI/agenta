import React, {useEffect, useState} from "react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {createPortal} from "react-dom"
import {Progress, Button, Tooltip, Modal} from "antd"
import {
    X,
    CheckCircle,
    Circle,
    CaretDown,
    CaretUp,
    Sparkle,
    Question,
} from "@phosphor-icons/react"
import {
    onboardingWidgetVisibleAtom,
    onboardingTodosWithStatusAtom,
    onboardingProgressAtom,
    markTodoCompleteAtom,
    toggleOnboardingWidgetAtom,
    hasSeenReopenHelperAtom,
} from "@/oss/state/onboarding/atoms"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {useAppId} from "@/oss/hooks/useAppId"

const OnboardingWidget: React.FC = () => {
    const router = useRouter()
    const posthog = usePostHogAg()
    const appId = useAppId()

    const [isVisible, setIsVisible] = useAtom(onboardingWidgetVisibleAtom)
    const [isMinimized, setIsMinimized] = useState(false)
    const [hasSeenHelper, setHasSeenHelper] = useAtom(hasSeenReopenHelperAtom)
    const [showReopenModal, setShowReopenModal] = useState(false)

    const todos = useAtomValue(onboardingTodosWithStatusAtom)
    const progress = useAtomValue(onboardingProgressAtom)
    const markComplete = useSetAtom(markTodoCompleteAtom)

    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    // Track widget visibility
    useEffect(() => {
        if (isVisible && !isMinimized) {
            posthog?.capture("onboarding_widget_opened")
        }
    }, [isVisible, isMinimized, posthog])

    const handleMinimize = () => {
        setIsMinimized(true)
        posthog?.capture("onboarding_widget_minimized")

        // Show reopen helper modal if user hasn't seen it before
        if (!hasSeenHelper) {
            setShowReopenModal(true)
        }
    }

    const handleMaximize = () => {
        setIsMinimized(false)
        posthog?.capture("onboarding_widget_maximized")
    }

    const handleClose = () => {
        setIsVisible(false)
        posthog?.capture("onboarding_widget_closed")
    }

    const handleTodoClick = (todoId: string, route: string) => {
        posthog?.capture("onboarding_todo_clicked", {todo_id: todoId})

        // Mark as complete
        markComplete(todoId)

        // Navigate to the route
        const {pathname} = router
        const workspaceMatch = pathname.match(/\/w\/([^/]+)/)
        const projectMatch = pathname.match(/\/p\/([^/]+)/)

        if (workspaceMatch && projectMatch) {
            const workspaceId = workspaceMatch[1]
            const projectId = projectMatch[1]
            let fullRoute = `/w/${workspaceId}/p/${projectId}${route}`

            // Handle app-specific routes
            if (route.includes("/apps") && appId) {
                fullRoute = `/w/${workspaceId}/p/${projectId}/apps/${appId}/playground`
            }

            router.push(fullRoute)
        }
    }

    const handleReopenModalOk = () => {
        setHasSeenHelper(true)
        setShowReopenModal(false)
    }

    if (!mounted || !isVisible) {
        return null
    }

    // Group todos by section
    const todosBySection: {[key: string]: typeof todos} = {
        main: [],
        "Technical Integrations": [],
        Collaboration: [],
    }

    todos.forEach((todo) => {
        const section = todo.section || "main"
        if (!todosBySection[section]) {
            todosBySection[section] = []
        }
        todosBySection[section].push(todo)
    })

    const widgetContent = (
        <>
            {/* Minimized State */}
            {isMinimized && (
                <div
                    className="fixed bottom-6 right-6 z-[1000]"
                    style={{
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    }}
                >
                    <Tooltip title="Expand Onboarding Guide" placement="left">
                        <Button
                            type="primary"
                            size="large"
                            icon={<Sparkle size={20} weight="fill" />}
                            onClick={handleMaximize}
                            className="flex items-center justify-center h-14 w-14 rounded-full"
                            style={{
                                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                border: "none",
                            }}
                        >
                            {progress.completed > 0 && (
                                <div className="absolute -top-1 -right-1 bg-green-500 text-white text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center">
                                    {progress.completed}
                                </div>
                            )}
                        </Button>
                    </Tooltip>
                </div>
            )}

            {/* Expanded State */}
            {!isMinimized && (
                <div
                    className="fixed bottom-6 right-6 z-[1000] bg-white rounded-lg w-96 flex flex-col"
                    style={{
                        boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
                        maxHeight: "calc(100vh - 100px)",
                    }}
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between p-4 rounded-t-lg"
                        style={{
                            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                        }}
                    >
                        <div className="flex items-center gap-2 text-white">
                            <Sparkle size={24} weight="fill" />
                            <h3 className="text-lg font-semibold m-0">Onboarding Guide</h3>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                type="text"
                                size="small"
                                icon={<CaretDown size={20} className="text-white" />}
                                onClick={handleMinimize}
                                className="flex items-center justify-center hover:bg-white/20"
                            />
                            <Button
                                type="text"
                                size="small"
                                icon={<X size={20} className="text-white" />}
                                onClick={handleClose}
                                className="flex items-center justify-center hover:bg-white/20"
                            />
                        </div>
                    </div>

                    {/* Progress */}
                    <div className="p-4 border-b">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">
                                Your Progress
                            </span>
                            <span className="text-sm font-semibold text-gray-900">
                                {progress.completed} of {progress.total} completed
                            </span>
                        </div>
                        <Progress
                            percent={progress.percentage}
                            strokeColor={{
                                "0%": "#667eea",
                                "100%": "#764ba2",
                            }}
                            showInfo={false}
                        />
                    </div>

                    {/* Todo List */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {/* Main todos */}
                        {todosBySection.main.length > 0 && (
                            <div className="mb-4">
                                {todosBySection.main.map((todo) => (
                                    <TodoItem
                                        key={todo.id}
                                        todo={todo}
                                        onClick={handleTodoClick}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Technical Integrations */}
                        {todosBySection["Technical Integrations"]?.length > 0 && (
                            <div className="mb-4">
                                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                    Technical Integrations
                                </h4>
                                {todosBySection["Technical Integrations"].map((todo) => (
                                    <TodoItem
                                        key={todo.id}
                                        todo={todo}
                                        onClick={handleTodoClick}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Collaboration */}
                        {todosBySection["Collaboration"]?.length > 0 && (
                            <div className="mb-4">
                                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                                    Collaboration
                                </h4>
                                {todosBySection["Collaboration"].map((todo) => (
                                    <TodoItem
                                        key={todo.id}
                                        todo={todo}
                                        onClick={handleTodoClick}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Reopen Helper Modal */}
            <Modal
                open={showReopenModal}
                onOk={handleReopenModalOk}
                onCancel={handleReopenModalOk}
                footer={[
                    <Button key="ok" type="primary" onClick={handleReopenModalOk}>
                        Got it!
                    </Button>,
                ]}
                centered
            >
                <div className="flex items-start gap-3 py-4">
                    <div className="flex-shrink-0 mt-1">
                        <Question size={24} weight="fill" className="text-blue-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold mb-2 mt-0">
                            Need help getting started?
                        </h3>
                        <p className="text-gray-600 mb-0">
                            You can reopen this onboarding guide anytime by clicking on{" "}
                            <strong>"Onboarding Guide"</strong> in the Help menu at the bottom of
                            the sidebar.
                        </p>
                    </div>
                </div>
            </Modal>
        </>
    )

    return createPortal(widgetContent, document.body)
}

interface TodoItemProps {
    todo: {
        id: string
        title: string
        completed: boolean
        route: string
    }
    onClick: (todoId: string, route: string) => void
}

const TodoItem: React.FC<TodoItemProps> = ({todo, onClick}) => {
    return (
        <div
            onClick={() => onClick(todo.id, todo.route)}
            className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all mb-2 ${
                todo.completed
                    ? "bg-green-50 hover:bg-green-100"
                    : "bg-gray-50 hover:bg-gray-100"
            }`}
        >
            <div className="flex-shrink-0 mt-0.5">
                {todo.completed ? (
                    <CheckCircle size={20} weight="fill" className="text-green-500" />
                ) : (
                    <Circle size={20} className="text-gray-400" />
                )}
            </div>
            <div className="flex-1">
                <p
                    className={`text-sm m-0 ${
                        todo.completed
                            ? "text-gray-500 line-through"
                            : "text-gray-900 font-medium"
                    }`}
                >
                    {todo.title}
                </p>
            </div>
        </div>
    )
}

export default OnboardingWidget
