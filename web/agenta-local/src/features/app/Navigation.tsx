import {
    ApiOutlined,
    CloudOutlined,
    CommentOutlined,
    MoonOutlined,
    RobotOutlined,
    SunOutlined,
} from "@ant-design/icons"
import {Button, Segmented, Tooltip} from "antd"
import Link from "next/link"
import {useRouter} from "next/router"

import {useLocalTheme} from "./ThemeProvider"

const routes = [
    {href: "/agents/", label: "Agents", icon: <RobotOutlined />},
    {href: "/sessions/", label: "Sessions", icon: <CommentOutlined />},
    {href: "/providers/", label: "Providers", icon: <ApiOutlined />},
]

export const Navigation = () => {
    const router = useRouter()
    const {resolved, setMode} = useLocalTheme()
    return (
        <>
            <aside className="app-sidebar" aria-label="Primary navigation">
                <div className="brand-lockup">
                    <img src="/assets/agenta-symbol.svg" alt="" width="30" height="30" />
                    <span>Agenta Local</span>
                </div>
                <nav className="nav-list">
                    {routes.map((route) => (
                        <Link
                            key={route.href}
                            href={route.href}
                            className={
                                router.pathname === route.href.slice(0, -1)
                                    ? "nav-link active"
                                    : "nav-link"
                            }
                        >
                            {route.icon}
                            <span>{route.label}</span>
                        </Link>
                    ))}
                </nav>
                <div className="sidebar-footer">
                    <a
                        href="https://cloud.agenta.ai"
                        target="_blank"
                        rel="noreferrer"
                        className="nav-link"
                    >
                        <CloudOutlined />
                        <span>Open Agenta Cloud</span>
                    </a>
                    <Segmented
                        block
                        aria-label="Color theme"
                        value={resolved}
                        onChange={(value) => setMode(value as "light" | "dark")}
                        options={[
                            {label: "Light", value: "light", icon: <SunOutlined />},
                            {label: "Dark", value: "dark", icon: <MoonOutlined />},
                        ]}
                    />
                </div>
            </aside>
            <nav className="mobile-nav" aria-label="Primary navigation">
                {routes.map((route) => (
                    <Link
                        key={route.href}
                        href={route.href}
                        aria-label={route.label}
                        className={router.pathname === route.href.slice(0, -1) ? "active" : ""}
                    >
                        {route.icon}
                        <span>{route.label}</span>
                    </Link>
                ))}
                <Tooltip title={`Use ${resolved === "dark" ? "light" : "dark"} mode`}>
                    <Button
                        type="text"
                        aria-label={`Use ${resolved === "dark" ? "light" : "dark"} mode`}
                        icon={resolved === "dark" ? <SunOutlined /> : <MoonOutlined />}
                        onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
                    />
                </Tooltip>
            </nav>
        </>
    )
}
