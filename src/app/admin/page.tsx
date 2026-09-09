import Link from "next/link";

import { UploadTrackForm } from "@/components/upload-track-form";

export default function AdminPage() {
  return (
    <main className="app-shell admin-shell">
      <nav className="top-navigation">
        <Link className="wordmark" href="/">cloud<span>music</span></Link>
        <div className="navigation-actions"><Link href="/">返回播放器</Link></div>
      </nav>

      <section className="admin-header">
        <p className="eyebrow">管理控制台</p>
        <h1>添加你的音乐</h1>
        <p>可选择音乐文件或整个文件夹。系统会先读取音频信息，确认后由浏览器直传 Supabase Storage。</p>
      </section>

      <section className="admin-card">
        <div className="section-heading">
          <div><p className="eyebrow">新歌曲</p><h2>上传到私人曲库</h2></div>
          <span className="status-badge">仅管理员</span>
        </div>
        <UploadTrackForm />
      </section>

      <section className="admin-checklist">
        <h2>上传前检查</h2>
        <ol>
          <li>已在 Supabase 为自己的账户设置管理员权限。</li>
          <li>Supabase Storage 已创建私有的 <code>music</code> bucket。</li>
          <li>Vercel 已设置 Supabase 项目 URL、Publishable key 与 Storage bucket 环境变量。</li>
        </ol>
      </section>
    </main>
  );
}
