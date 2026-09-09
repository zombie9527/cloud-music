import { createBrowserClient } from "@supabase/ssr";

import { environment } from "@/lib/env";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
  );
}
