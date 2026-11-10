"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { updateSettingsAction } from "@/modules/shop/actions";
import { settingsPatchSchema, type SettingsPatch } from "@/modules/shop/schema";

export type FieldErrors = Record<string, string>;

/**
 * Shared submit plumbing for a settings tab. `build` turns the form into a patch
 * or returns field errors; invalid forms are never sent to the server.
 */
export type BuildResult = { patch: SettingsPatch } | { errors: FieldErrors };

/**
 * Combines parse errors (money/percent fields) with the shared Zod schema's
 * verdict on the rest. Field ids equal patch keys, so issues map onto fields.
 */
export function buildResult(patch: SettingsPatch, parseErrors: FieldErrors = {}): BuildResult {
  const errors: FieldErrors = { ...parseErrors };
  const checked = settingsPatchSchema.safeParse(patch);
  if (!checked.success) {
    for (const issue of checked.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !(key in errors)) errors[key] = issue.message;
    }
  }
  return Object.keys(errors).length > 0 ? { errors } : { patch };
}

export function useSettingsForm(build: (data: FormData) => BuildResult) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    setFormError(null);
    const built = build(new FormData(e.currentTarget));
    if ("errors" in built) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await updateSettingsAction(built.patch);
      if (result.ok) setSaved(true);
      else setFormError(result.error.message);
    });
  }

  return { errors, formError, saved, pending, onSubmit };
}

export function SettingsForm({
  form,
  children,
}: {
  form: ReturnType<typeof useSettingsForm>;
  children: ReactNode;
}) {
  return (
    <form onSubmit={form.onSubmit} noValidate className="max-w-xl space-y-4">
      {children}
      {form.formError ? (
        <p role="alert" className="text-sm text-red-600">
          {form.formError}
        </p>
      ) : null}
      {form.saved ? (
        <p role="status" className="text-sm text-green-700">
          Saved
        </p>
      ) : null}
      <button
        type="submit"
        disabled={form.pending}
        className="min-h-11 rounded bg-black px-4 font-medium text-white disabled:opacity-50"
      >
        {form.pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

const INPUT = "w-full rounded border border-gray-300 px-3 py-2";

export function TextField({
  id,
  label,
  hint,
  error,
  defaultValue,
  maxLength,
  inputMode,
  className,
  upper,
  onValueChange,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  defaultValue: string;
  maxLength?: number;
  inputMode?: "decimal" | "numeric" | "text";
  className?: string;
  upper?: boolean;
  /** Called with the current value on every edit (the field stays uncontrolled). */
  onValueChange?: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        defaultValue={defaultValue}
        maxLength={maxLength}
        inputMode={inputMode}
        onChange={onValueChange ? (e) => onValueChange(e.currentTarget.value) : undefined}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`${INPUT} ${upper ? "uppercase" : ""} ${className ?? ""}`}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  error,
  defaultValue,
  maxLength,
  onValueChange,
}: {
  id: string;
  label: string;
  error?: string;
  defaultValue: string;
  maxLength: number;
  onValueChange?: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name={id}
        rows={3}
        defaultValue={defaultValue}
        maxLength={maxLength}
        onChange={onValueChange ? (e) => onValueChange(e.currentTarget.value) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={INPUT}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  id,
  label,
  defaultValue,
  options,
  onValueChange,
}: {
  id: string;
  label: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
  onValueChange?: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={id}
        defaultValue={defaultValue}
        onChange={onValueChange ? (e) => onValueChange(e.currentTarget.value) : undefined}
        className={INPUT}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckboxField({
  id,
  label,
  defaultChecked,
}: {
  id: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center gap-2">
      <input id={id} name={id} type="checkbox" defaultChecked={defaultChecked} className="size-5" />
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
    </div>
  );
}

export function text(data: FormData, name: string): string {
  const v = data.get(name);
  return typeof v === "string" ? v : "";
}

export function checked(data: FormData, name: string): boolean {
  return data.get(name) === "on";
}
