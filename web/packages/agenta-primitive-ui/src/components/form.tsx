"use client"

import {createContext, useContext, useId} from "react"

import {zodResolver} from "@hookform/resolvers/zod"
import {
    Controller,
    FormProvider,
    useFieldArray,
    useForm,
    useFormContext,
    type ControllerFieldState,
    type ControllerRenderProps,
    type DefaultValues,
    type FieldArrayPath,
    type FieldArrayWithId,
    type FieldPath,
    type FieldValues,
    type UseFieldArrayReturn,
    type UseFormReturn,
} from "react-hook-form"
import type {z} from "zod"

import {cn} from "@agenta/primitive-ui/lib/utils"

import {Field, FieldContent, FieldDescription, FieldError, FieldLabel} from "./field"

/**
 * App-level form API over react-hook-form + zod.
 * Mirrors the ergonomics of antd Form (declarative items, path binding, list
 * fields, imperative handle) so per-file migration is mechanical.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZodObject = z.ZodType<any, any, any>

export interface UseAppFormOptions<TSchema extends AnyZodObject> {
    schema: TSchema
    defaultValues?: DefaultValues<z.input<TSchema>>
    mode?: "onSubmit" | "onBlur" | "onChange" | "onTouched" | "all"
}

export type AppForm<TValues extends FieldValues = FieldValues> = UseFormReturn<TValues>

export function useAppForm<TSchema extends AnyZodObject>({
    schema,
    defaultValues,
    mode = "onSubmit",
}: UseAppFormOptions<TSchema>): AppForm<z.input<TSchema>> {
    return useForm<z.input<TSchema>>({
        resolver: zodResolver(schema as never) as never,
        defaultValues,
        mode,
    })
}

export interface FormProps<TValues extends FieldValues> extends Omit<
    React.ComponentProps<"form">,
    "onSubmit"
> {
    form: AppForm<TValues>
    onSubmit?: (values: TValues) => void | Promise<void>
}

export function Form<TValues extends FieldValues>({
    form,
    onSubmit,
    className,
    children,
    ...props
}: FormProps<TValues>) {
    return (
        <FormProvider {...form}>
            <form
                data-slot="form"
                className={cn("flex flex-col gap-4", className)}
                onSubmit={onSubmit ? form.handleSubmit((v) => onSubmit(v as TValues)) : undefined}
                noValidate
                {...props}
            >
                {children}
            </form>
        </FormProvider>
    )
}

interface FormFieldContextValue {
    id: string
    name: string
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null)

export function useFormField() {
    const ctx = useContext(FormFieldContext)
    if (!ctx) throw new Error("useFormField must be used inside <FormField>")
    return ctx
}

export interface FormFieldProps<
    TValues extends FieldValues,
    TName extends FieldPath<TValues> = FieldPath<TValues>,
> {
    name: TName
    label?: React.ReactNode
    description?: React.ReactNode
    required?: boolean
    className?: string
    children: (
        field: ControllerRenderProps<TValues, TName> & {id: string; "aria-invalid": boolean},
        state: ControllerFieldState,
    ) => React.ReactElement
}

export function FormField<
    TValues extends FieldValues,
    TName extends FieldPath<TValues> = FieldPath<TValues>,
>({name, label, description, required, className, children}: FormFieldProps<TValues, TName>) {
    const form = useFormContext<TValues>()
    const id = useId()

    return (
        <FormFieldContext.Provider value={{id, name}}>
            <Controller
                control={form.control}
                name={name}
                render={({field, fieldState}) => (
                    <Field className={className} data-invalid={fieldState.invalid || undefined}>
                        {label !== undefined && (
                            <FieldLabel htmlFor={id}>
                                {label}
                                {required && (
                                    <span aria-hidden className="text-destructive">
                                        *
                                    </span>
                                )}
                            </FieldLabel>
                        )}
                        <FieldContent>
                            {children(
                                {...field, id, "aria-invalid": fieldState.invalid},
                                fieldState,
                            )}
                            {description !== undefined && (
                                <FieldDescription>{description}</FieldDescription>
                            )}
                            {fieldState.error?.message && (
                                <FieldError>{fieldState.error.message}</FieldError>
                            )}
                        </FieldContent>
                    </Field>
                )}
            />
        </FormFieldContext.Provider>
    )
}

export interface FormListProps<
    TValues extends FieldValues,
    TName extends FieldArrayPath<TValues> = FieldArrayPath<TValues>,
> {
    name: TName
    children: (
        fields: FieldArrayWithId<TValues, TName>[],
        helpers: Pick<UseFieldArrayReturn<TValues, TName>, "append" | "remove" | "move" | "insert">,
    ) => React.ReactNode
}

export function FormList<
    TValues extends FieldValues,
    TName extends FieldArrayPath<TValues> = FieldArrayPath<TValues>,
>({name, children}: FormListProps<TValues, TName>) {
    const form = useFormContext<TValues>()
    const {fields, append, remove, move, insert} = useFieldArray<TValues, TName>({
        control: form.control,
        name,
    })
    return <>{children(fields, {append, remove, move, insert})}</>
}

export function FormActions({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="form-actions"
            className={cn("flex items-center justify-end gap-2", className)}
            {...props}
        />
    )
}
