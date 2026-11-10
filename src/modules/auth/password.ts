import { hash, verify } from "@node-rs/argon2";

export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return verify(hashed, plain);
}
