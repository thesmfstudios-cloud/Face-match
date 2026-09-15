import { createClient } from '@supabase/supabase-js';

export function getSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase browser environment variables.');

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Supabase's RPC builder is thenable but may not expose `.catch()` directly.
  // Wrap it as a real Promise so existing UI error handling using `.catch()` works.
  const rpc = client.rpc.bind(client);
  client.rpc = (...args) => Promise.resolve(rpc(...args));

  return client;
}
