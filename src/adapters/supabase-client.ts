import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Single Supabase client for the whole app, built from env vars (design doc §5 — Supabase backend).
 * `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are the project URL and the publishable/anon key — safe to
 * ship in the client bundle, never the service_role key. See `.env.example`.
 */
let client: SupabaseClient | undefined

export function getSupabaseClient(): SupabaseClient {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — sync requires a configured Supabase project')
  }
  client = createClient(url, anonKey)
  return client
}
