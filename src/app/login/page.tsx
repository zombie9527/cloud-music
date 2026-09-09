import Link from "next/link";

import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="app-shell login-shell">
      <nav className="top-navigation">
        <Link className="wordmark" href="/">cloud<span>music</span></Link>
        <Link href="/">返回首页</Link>
      </nav>
      <section className="login-card">
        <p className="eyebrow">私人访问</p>
        <h1>登录你的曲库</h1>
        <p>使用在 Supabase 中创建的账户登录。此播放器仅面向你授权的用户。</p>
        <LoginForm />
      </section>
    </main>
  );
}
