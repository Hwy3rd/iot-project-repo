import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Option } from '@/lib/lookups'
import type { ComponentProps, ReactNode } from 'react'
import {
  Controller,
  type Control,
  type ControllerProps,
  type FieldError as FormFieldError,
  type FieldValues,
  type Path,
} from 'react-hook-form'

// Labelled inputs for the create dialogs (react-hook-form). The text field
// takes register()'s props; the select is wired through a Controller since
// Radix Select isn't a native input.

export function TextField({
  id,
  label,
  error,
  description,
  ...inputProps
}: {
  id: string
  label: string
  error?: FormFieldError
  description?: ReactNode
} & ComponentProps<typeof Input>) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} autoComplete="off" aria-invalid={!!error} {...inputProps} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  )
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  rules,
  id,
  label,
  options,
  placeholder = 'Chọn…',
  description,
  disabled,
}: {
  control: Control<T>
  name: Path<T>
  rules?: ControllerProps<T>['rules']
  id: string
  label: string
  options: readonly Option[]
  placeholder?: string
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <Controller
      control={control}
      name={name}
      rules={rules}
      render={({ field, fieldState }) => (
        <Field data-invalid={!!fieldState.error}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Select
            name={field.name}
            value={field.value ?? ''}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <SelectTrigger
              id={id}
              ref={field.ref}
              onBlur={field.onBlur}
              aria-invalid={!!fieldState.error}
              className="w-full"
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FieldDescription>{description}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}
