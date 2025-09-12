import {useState} from "react"

import {Button, Form, FormProps, Input} from "antd"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {signUp} from "supertokens-auth-react/recipe/emailpassword"
import {useLocalStorage} from "usehooks-ts"

import {isDemo} from "@/oss/lib/helpers/utils"
import {useOrgData} from "@/oss/state/org"
import {selectedOrgIdAtom} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"

import ShowErrorMessage from "../assets/ShowErrorMessage"
import {EmailPasswordAuthProps} from "../assets/types"

const EmailPasswordAuth = ({message, setMessage, authErrorMsg}: EmailPasswordAuthProps) => {
    const {reset: resetProfileData} = useProfileData()
    const {reset: resetOrgData} = useOrgData()
    const {reset: resetProjectData} = useProjectData()
    const setSelectedOrgId = useSetAtom(selectedOrgIdAtom)
    const router = useRouter()
    const [invite] = useLocalStorage("invite", {})
    const [form, setForm] = useState({email: "", password: ""})
    const [isLoading, setIsLoading] = useState(false)

    const signUpClicked: FormProps<{email: string; password: string}>["onFinish"] = async (
        values,
    ) => {
        try {
            setIsLoading(true)
            const response = await signUp({
                formFields: [
                    {
                        id: "email",
                        value: values.email,
                    },
                    {
                        id: "password",
                        value: values.password,
                    },
                ],
            })

            if (response.status === "SIGN_UP_NOT_ALLOWED") {
                setMessage({
                    message: "You need to be invited by the organization owner to gain access.",
                    type: "error",
                })
            } else if (response.status === "FIELD_ERROR") {
                response.formFields.map((res) => {
                    setMessage({message: res.error, type: "error"})
                })
            } else {
                resetProfileData()
                resetOrgData()
                resetProjectData()
                // Clear selected org via atom to keep storage in sync
                setSelectedOrgId(null)
                setMessage({message: "Verification successful", type: "success"})

                const isInvitedUser = !!(
                    router.query?.token ||
                    (invite && Object.keys(invite || {}).length > 0)
                )
                const isNewUser =
                    isDemo() &&
                    (response as any).createdNewRecipeUser &&
                    (response as any).user?.loginMethods?.length === 1

                if (isNewUser) {
                    if (isInvitedUser) {
                        await router.push("/workspaces/accept?survey=true")
                    } else {
                        await router.push("/post-signup")
                    }
                } else {
                    if (isInvitedUser) {
                        await router.push("/workspaces/accept")
                    } else {
                        await router.push("/apps")
                    }
                }
            }
        } catch (error) {
            authErrorMsg(error)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div>
            <Form className="w-full flex flex-col gap-4" layout="vertical" onFinish={signUpClicked}>
                <Form.Item
                    name="email"
                    label="Email"
                    className="[&_.ant-form-item-required]:before:!hidden [&_.ant-form-item-required]:font-medium w-full mb-0 flex flex-col gap-1"
                    rules={[{required: true, message: "Please add your email!"}]}
                >
                    <Input
                        size="large"
                        type="email"
                        value={form.email}
                        placeholder="Enter valid email address"
                        status={message.type === "error" ? "error" : ""}
                        onChange={(e) => setForm({...form, email: e.target.value})}
                    />
                </Form.Item>
                <Form.Item
                    name="password"
                    label="Password"
                    className="[&_.ant-form-item-required]:before:!hidden [&_.ant-form-item-required]:font-medium w-full mb-0 flex flex-col gap-1"
                    rules={[{required: true, message: "Please add your password!"}]}
                >
                    <Input
                        size="large"
                        type="password"
                        value={form.password}
                        placeholder="Enter a unique password"
                        status={message.type === "error" ? "error" : ""}
                        onChange={(e) => setForm({...form, password: e.target.value})}
                    />
                </Form.Item>

                <Button
                    size="large"
                    type="primary"
                    htmlType="submit"
                    className="w-full"
                    loading={isLoading}
                >
                    Sign in
                </Button>
                {message.type == "error" && (
                    <ShowErrorMessage info={message} className="text-start" />
                )}
            </Form>
        </div>
    )
}

export default EmailPasswordAuth
