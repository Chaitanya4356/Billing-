import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Billing",
};

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
          <h2 className="text-lg text-gray-600">Sign in</h2>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
