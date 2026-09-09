"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    setIsSubmitting(true);
    setStatusMessage("");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.error("[auth/login] Sign-in failed", {
        errorCode: error.code,
        errorMessage: error.message,
      });
      setStatusMessage(error.message);
      setIsSubmitting(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={(event) => void signIn(event)}>
      <label>邮箱<input autoComplete="email" name="email" required type="email" /></label>
      <label>密码<input autoComplete="current-password" name="password" required type="password" /></label>
      {statusMessage && <p className="form-error" role="alert">{statusMessage}</p>}
      <button className="button button-primary" disabled={isSubmitting} type="submit">
        {isSubmitting ? "正在登录..." : "登录"}
      </button>
    </form>
  );
}
