export type Role = "OWNER" | "CASHIER";

export interface AuthContext {
  shopId: string;
  userId: string;
  role: Role;
}
