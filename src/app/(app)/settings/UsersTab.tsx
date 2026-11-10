"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { PasswordField, text, TextField, type FieldErrors } from "@/components/form-kit";
import {
  changeOwnPasswordAction,
  createCashierAction,
  resetPasswordAction,
  setUserActiveAction,
} from "@/modules/users/actions";
import {
  changeOwnPasswordSchema,
  createCashierSchema,
  NAME_MAX,
  passwordSchema,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
} from "@/modules/users/schema";
import type { UserRow } from "@/modules/users/service";
import type { ZodType } from "zod";

const BUTTON = "min-h-11 rounded px-4 font-medium disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-black text-white`;
const SECONDARY = `${BUTTON} border border-gray-300 bg-white`;
const DANGER = `${BUTTON} bg-red-600 text-white`;

/** Zod issues keyed by the form field ids in `fieldIds` (schema key -> field id). */
function fieldErrors(schema: ZodType, value: unknown, fieldIds: Record<string, string>): FieldErrors {
  const r = schema.safeParse(value);
  const errors: FieldErrors = {};
  if (!r.success) {
    for (const issue of r.error.issues) {
      const id = fieldIds[String(issue.path[0] ?? "")];
      if (id && !(id in errors)) errors[id] = issue.message;
    }
  }
  return errors;
}

function Status({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className="text-sm text-green-700">
      {message}
    </p>
  ) : null;
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-red-600">
      {message}
    </p>
  ) : null;
}

export function UsersTab({ users }: { users: UserRow[] }) {
  return (
    <div className="space-y-10">
      <UsersTable users={users} />
      <CreateCashierForm />
      <ChangeOwnPasswordForm />
    </div>
  );
}

function UsersTable({ users }: { users: UserRow[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Users</h2>
      <div className="overflow-x-auto">
        <table aria-label="Users" className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-600">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Name</th>
              <th scope="col" className="py-2 pr-3 font-medium">Username</th>
              <th scope="col" className="py-2 pr-3 font-medium">Role</th>
              <th scope="col" className="py-2 pr-3 font-medium">Status</th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserTableRow key={u.id} user={u} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserTableRow({ user }: { user: UserRow }) {
  const [mode, setMode] = useState<"idle" | "reset" | "confirmDeactivate">("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setActive(active: boolean) {
    setStatus(null);
    setError(null);
    startTransition(async () => {
      const result = await setUserActiveAction(user.id, active);
      if (result.ok) {
        setMode("idle");
        setStatus(active ? `${user.username} reactivated` : `${user.username} deactivated and signed out`);
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <tr className="border-b border-gray-100 align-top" data-username={user.username}>
      <td className="py-3 pr-3">{user.name}</td>
      <td className="py-3 pr-3 font-mono">{user.username}</td>
      <td className="py-3 pr-3">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            user.role === "OWNER" ? "bg-black text-white" : "bg-gray-100 text-gray-800"
          }`}
        >
          {user.role === "OWNER" ? "Owner" : "Cashier"}
        </span>
      </td>
      <td className="py-3 pr-3">
        <span className={user.isActive ? "text-green-700" : "text-gray-500"}>
          {user.isActive ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="space-y-2 py-3">
        {user.role === "CASHIER" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={SECONDARY}
                aria-expanded={mode === "reset"}
                onClick={() => {
                  setStatus(null);
                  setError(null);
                  setMode(mode === "reset" ? "idle" : "reset");
                }}
              >
                Reset password<span className="sr-only"> for {user.username}</span>
              </button>
              {user.isActive ? (
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={pending}
                  onClick={() => {
                    setStatus(null);
                    setError(null);
                    setMode("confirmDeactivate");
                  }}
                >
                  Deactivate<span className="sr-only"> {user.username}</span>
                </button>
              ) : (
                <button type="button" className={SECONDARY} disabled={pending} onClick={() => setActive(true)}>
                  Reactivate<span className="sr-only"> {user.username}</span>
                </button>
              )}
            </div>
            {mode === "confirmDeactivate" ? (
              <div className="space-y-2 rounded border border-red-200 bg-red-50 p-3">
                <p className="text-sm">
                  Deactivate {user.name}? They are signed out at once and cannot sign in until reactivated.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={DANGER} disabled={pending} onClick={() => setActive(false)}>
                    {pending ? "Deactivating…" : "Confirm deactivate"}
                  </button>
                  <button type="button" className={SECONDARY} disabled={pending} onClick={() => setMode("idle")}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {mode === "reset" ? (
              <ResetPasswordForm
                user={user}
                onDone={() => {
                  setMode("idle");
                  setStatus(`Password reset for ${user.username}. They have been signed out.`);
                }}
                onCancel={() => setMode("idle")}
              />
            ) : null}
            <FormError message={error} />
            <Status message={status} />
          </>
        ) : null}
      </td>
    </tr>
  );
}

function ResetPasswordForm({
  user,
  onDone,
  onCancel,
}: {
  user: UserRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const fieldId = `reset-password-${user.id}`;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = e.currentTarget;
    const newPassword = text(new FormData(form), fieldId);
    const checked = passwordSchema.safeParse(newPassword);
    const errs: FieldErrors = checked.success
      ? {}
      : { [fieldId]: checked.error.issues[0]?.message ?? "Invalid password" };
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    startTransition(async () => {
      const result = await resetPasswordAction(user.id, newPassword);
      if (result.ok) {
        form.reset();
        onDone();
      } else {
        setFormError(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-sm space-y-2 rounded border border-gray-200 p-3">
      <PasswordField
        id={fieldId}
        label={`New password for ${user.username}`}
        hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`}
        autoComplete="new-password"
        error={errors[fieldId]}
      />
      <FormError message={formError} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? "Saving…" : "Set new password"}
        </button>
        <button type="button" className={SECONDARY} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CreateCashierForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setStatus(null);
    const form = e.currentTarget;
    const d = new FormData(form);
    const input = {
      name: text(d, "new-name"),
      username: text(d, "new-username"),
      password: text(d, "new-password"),
    };
    const errs = fieldErrors(createCashierSchema, input, {
      name: "new-name",
      username: "new-username",
      password: "new-password",
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    startTransition(async () => {
      const result = await createCashierAction(input);
      if (result.ok) {
        form.reset();
        setStatus(`Cashier ${result.data.username} created`);
      } else if (result.error.code === "CONFLICT") {
        setErrors({ "new-username": result.error.message });
      } else {
        setFormError(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="create-cashier-heading" className="max-w-xl space-y-4">
      <h2 id="create-cashier-heading" className="text-lg font-semibold">
        Create cashier
      </h2>
      <TextField id="new-name" label="Name" defaultValue="" maxLength={NAME_MAX} error={errors["new-name"]} />
      <TextField
        id="new-username"
        label="Username"
        hint={`3 to ${USERNAME_MAX} characters: letters, digits, dot, dash or underscore.`}
        defaultValue=""
        maxLength={USERNAME_MAX}
        error={errors["new-username"]}
      />
      <PasswordField
        id="new-password"
        label="Password"
        hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`}
        autoComplete="new-password"
        error={errors["new-password"]}
      />
      <FormError message={formError} />
      <Status message={status} />
      <button type="submit" className={PRIMARY} disabled={pending}>
        {pending ? "Creating…" : "Create cashier"}
      </button>
    </form>
  );
}

function ChangeOwnPasswordForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = e.currentTarget;
    const d = new FormData(form);
    const current = text(d, "current-password");
    const next = text(d, "own-new-password");
    const errs = fieldErrors(
      changeOwnPasswordSchema,
      { current, next },
      { current: "current-password", next: "own-new-password" },
    );
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    startTransition(async () => {
      const result = await changeOwnPasswordAction(current, next);
      if (result.ok) {
        // Every session (this one too) was revoked: sign in again.
        router.replace("/login");
      } else {
        form.reset();
        setFormError(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="change-password-heading" className="max-w-xl space-y-4">
      <h2 id="change-password-heading" className="text-lg font-semibold">
        Change my password
      </h2>
      <p className="text-sm text-gray-600">You will be signed out everywhere and asked to sign in again.</p>
      <PasswordField
        id="current-password"
        label="Current password"
        autoComplete="current-password"
        error={errors["current-password"]}
      />
      <PasswordField
        id="own-new-password"
        label="New password"
        hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`}
        autoComplete="new-password"
        error={errors["own-new-password"]}
      />
      <FormError message={formError} />
      <button type="submit" className={PRIMARY} disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
