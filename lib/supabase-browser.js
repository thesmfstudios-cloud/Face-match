import { createClient } from '@supabase/supabase-js';

export function getSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase browser environment variables.');

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Normalize the RPC builder to a native Promise for UI `.catch()` compatibility.
  const rpc = client.rpc.bind(client);
  client.rpc = (...args) => Promise.resolve(rpc(...args));

  return client;
}
