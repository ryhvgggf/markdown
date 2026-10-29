-- 第 3 階段（帳號、同步、加密）資料表與 RLS。
-- 到 Supabase Dashboard → SQL Editor → New query，貼上整份執行即可（可重複執行）。
-- 對應設計文件 docs/superpowers/specs/2026-10-29-notes-v2-phase3-design.md 第 4 節。

create table if not exists vaults (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists vault_keys (
  vault_id text primary key references vaults(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wrapped_key_password text not null,
  kdf_params_password jsonb not null,
  wrapped_key_recovery text not null,
  kdf_params_recovery jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- docId = 結構清單（vaultId + '-manifest'）、各已同步筆記的文件 id、或偏好文件 id（見設計文件 §3.1、§7）
create table if not exists doc_updates (
  id bigserial primary key,
  vault_id text not null references vaults(id) on delete cascade,
  doc_id text not null,
  seq integer not null,
  ciphertext bytea not null,
  device_id text not null,
  created_at timestamptz not null default now(),
  unique (vault_id, doc_id, seq)
);
create index if not exists doc_updates_vault_doc_idx on doc_updates (vault_id, doc_id, seq);

create table if not exists doc_snapshots (
  vault_id text not null references vaults(id) on delete cascade,
  doc_id text not null,
  ciphertext bytea not null,
  up_to_seq integer not null,
  updated_at timestamptz not null default now(),
  primary key (vault_id, doc_id)
);

-- 已由 0002 取代為 attachment_refs（一個附件可被多篇筆記共用），此處保留只為了歷史紀錄
create table if not exists attachments (
  id text primary key,
  vault_id text not null references vaults(id) on delete cascade,
  note_id text not null,
  storage_path text not null,
  size integer not null,
  created_at timestamptz not null default now()
);

-- 第 4 階段（分享）用，本階段只建表不寫邏輯
create table if not exists share_links (
  id text primary key,
  vault_id text not null references vaults(id) on delete cascade,
  note_id text not null,
  created_at timestamptz not null default now()
);

alter table vaults enable row level security;
alter table vault_keys enable row level security;
alter table devices enable row level security;
alter table doc_updates enable row level security;
alter table doc_snapshots enable row level security;
alter table attachments enable row level security;
alter table share_links enable row level security;

drop policy if exists "own vaults" on vaults;
create policy "own vaults" on vaults for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own vault_keys" on vault_keys;
create policy "own vault_keys" on vault_keys for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own devices" on devices;
create policy "own devices" on devices for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own doc_updates" on doc_updates;
create policy "own doc_updates" on doc_updates for all
  using (exists (select 1 from vaults v where v.id = doc_updates.vault_id and v.user_id = auth.uid()))
  with check (exists (select 1 from vaults v where v.id = doc_updates.vault_id and v.user_id = auth.uid()));

drop policy if exists "own doc_snapshots" on doc_snapshots;
create policy "own doc_snapshots" on doc_snapshots for all
  using (exists (select 1 from vaults v where v.id = doc_snapshots.vault_id and v.user_id = auth.uid()))
  with check (exists (select 1 from vaults v where v.id = doc_snapshots.vault_id and v.user_id = auth.uid()));

drop policy if exists "own attachments" on attachments;
create policy "own attachments" on attachments for all
  using (exists (select 1 from vaults v where v.id = attachments.vault_id and v.user_id = auth.uid()))
  with check (exists (select 1 from vaults v where v.id = attachments.vault_id and v.user_id = auth.uid()));

drop policy if exists "own share_links" on share_links;
create policy "own share_links" on share_links for all
  using (exists (select 1 from vaults v where v.id = share_links.vault_id and v.user_id = auth.uid()))
  with check (exists (select 1 from vaults v where v.id = share_links.vault_id and v.user_id = auth.uid()));
