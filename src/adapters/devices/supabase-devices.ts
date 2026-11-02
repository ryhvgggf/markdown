import type { SupabaseClient } from '@supabase/supabase-js'
import { SyncError } from '@/adapters/sync/types'
import type { DeviceAdapter, DeviceRecord } from './types'

type Row = { id: string; name: string; created_at: string; last_seen_at: string }

const toError = (e: { message: string; code?: string }) => new SyncError('unknown', e.message, { cause: e })

/** `DeviceAdapter` on Supabase's `devices` table (migration 0001; RLS: own rows only). */
export class SupabaseDevices implements DeviceAdapter {
  constructor(private client: SupabaseClient) {}

  async touch(id: string): Promise<boolean> {
    const { data, error } = await this.client.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', id).select('id')
    if (error) throw toError(error)
    return (data ?? []).length > 0
  }

  async register(id: string, userId: string, name: string): Promise<void> {
    const { error } = await this.client.from('devices').insert({ id, user_id: userId, name })
    if (error && error.code !== '23505') throw toError(error) // 23505: already there
  }

  async list(): Promise<DeviceRecord[]> {
    const { data, error } = await this.client.from('devices').select('id, name, created_at, last_seen_at').order('last_seen_at', { ascending: false })
    if (error) throw toError(error)
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: new Date(r.created_at).getTime(),
      lastSeenAt: new Date(r.last_seen_at).getTime(),
    }))
  }

  async rename(id: string, name: string): Promise<void> {
    const { error } = await this.client.from('devices').update({ name }).eq('id', id)
    if (error) throw toError(error)
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('devices').delete().eq('id', id)
    if (error) throw toError(error)
  }
}
