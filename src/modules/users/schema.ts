import { z } from "zod";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 60;

/** Lowercased before checking, so "Asha.K" and "asha.k" are the same username. */
export const usernameSchema = z
  .string({ error: "Enter a username" })
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
  .max(USERNAME_MAX, `Username is at most ${USERNAME_MAX} characters`)
  .regex(/^[a-z0-9._-]+$/, "Username can only have letters, digits, dot, dash and underscore");

/** No composition rules; never trimmed (spaces are part of a password). */
export const passwordSchema = z
  .string({ error: "Enter a password" })
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password is at most ${PASSWORD_MAX} characters`);

export const nameSchema = z
  .string({ error: "Enter a name" })
  .trim()
  .min(1, "Name is required")
  .max(NAME_MAX, `Name is at most ${NAME_MAX} characters`);

export const createCashierSchema = z
  .object({ name: nameSchema, username: usernameSchema, password: passwordSchema })
  .strict();

export const resetPasswordSchema = z.object({ newPassword: passwordSchema }).strict();

export const setActiveSchema = z.object({ active: z.boolean({ error: "Invalid status" }) }).strict();

/**
 * The current password is only checked against the stored hash; the bound
 * keeps a huge value from being fed to argon2.
 */
export const changeOwnPasswordSchema = z
  .object({
    current: z.string({ error: "Enter your current password" }).min(1, "Enter your current password").max(256, "Current password is incorrect"),
    next: passwordSchema,
  })
  .strict();

export type CreateCashierInput = z.input<typeof createCashierSchema>;
