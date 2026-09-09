# cloudmusic

私人云端音乐播放器，由 **Vercel + Supabase** 组成。Supabase Storage 保存私有音频文件，Supabase Database/Auth 保存认证与曲库资料，Vercel 仅提供网页与短时效签名 URL。

> 仅上传、播放和分享你拥有合法权利的音乐文件。

## 架构与安全边界

```text
电脑管理台 / Android PWA
         |
          +-- Vercel: Next.js、Supabase 会话校验、签名 URL
          `-- Supabase: Auth、Storage、曲目/歌单/收藏数据和 RLS
```

- 音频上传和播放均由浏览器直接连接 Supabase Storage，避免 Vercel 函数中转大文件。
- Storage bucket 保持私有，仅通过登录后生成的短时效签名链接访问。
- 播放 URL 有效期 15 分钟；上传链接由 Supabase Storage 签发并短时有效。
- 只有在 `profiles.is_admin` 为 `true` 的用户可以请求上传 URL 或写入 `tracks`。

## 本地启动

```bash
cp .env.example .env.local
npm install
npm run dev
```

填写 `.env.local` 后，访问 <http://localhost:3000>。

## Supabase 设置

1. 创建一个 Supabase 项目。
2. 打开 SQL Editor，执行 `supabase/migrations/202609080001_initial_schema.sql` 的全部内容。
   - 如果你已经执行过此前版本，再额外执行 `supabase/migrations/202609090001_batch_upload_and_dislikes.sql`。
3. 在 **Authentication → Providers** 启用 Email；私人使用建议关闭公开注册，先由你自己创建账户。
4. 登录一次以创建 Profile，再在 SQL Editor 执行：

   ```sql
   update public.profiles
   set is_admin = true
   where id = '你的-auth.users-uuid';
   ```

5. 从 **Project Settings → API** 复制 Project URL 和 Publishable key，填入环境变量。
6. 迁移会创建一个私有的 `music` Storage bucket；如果你想改 bucket 名称，请同步修改 SQL 和 `SUPABASE_STORAGE_BUCKET`。

## 部署到 Vercel

1. 把项目推送到自己的 GitHub 私有仓库。
2. 在 Vercel 导入仓库，Framework 选择 Next.js。
3. 在 **Settings → Environment Variables** 添加 `.env.example` 中的所有变量。
4. 用 Android Chrome 打开部署域名，在菜单选择 **安装应用** 或 **添加到主屏幕**。

## 当前 MVP 范围

- 手机优先的 PWA 页面和 HTML 音频播放器；
- 管理台直传 Supabase Storage；
- 电脑端批量选择文件或文件夹，自动读取曲名、歌手、专辑和时长，确认后逐首上传；
- 私有短时效播放链接；
- 默认首页为手机优先播放器；管理功能位于 `/admin`；
- 可将歌曲标记为不喜欢并从个人列表隐藏；管理员可确认后永久删除曲目和音频文件；
- Supabase 数据模型：歌曲、收藏、歌单和歌单曲目；
- RLS：普通登录用户可读曲库并管理自己的歌单/收藏，管理员管理歌曲。

下一步可实现：登录页和会话中间件、从 Supabase 加载真实曲目、封面/歌词上传、播放历史、队列、随机播放和主动离线缓存。
