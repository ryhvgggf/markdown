-- 3c 審查修正：附件歸屬改為多對多，並把 Storage bucket 與其 RLS 寫進 migration（之前是在 Dashboard 手動建的）。
-- 到 Supabase Dashboard → SQL Editor → New query，貼上整份執行即可（可重複執行）。

-- 一個附件可被多篇筆記共用（本機 attachmentRefs 就是多對多）。舊的 attachments 表每個附件只記一篇筆記，
-- 關掉其中一篇的同步會把另一篇還在用的檔案刪掉，所以換成「哪篇筆記用了哪個附件」的參照表。
-- 舊表只有 smoke test 留下的資料（測試結束時已清空），直接刪除。
drop table if exists attachments;

create table if not exists attachment_refs (
  vault_id text not null references vaults(id) on delete cascade,
  attachment_id text not null,
  note_id text not null,
  size integer not null,
  created_at timestamptz not null default now(),
  primary key (vault_id, attachment_id, note_id)
);
create index if not exists attachment_refs_note_idx on attachment_refs (vault_id, note_id);

alter table attachment_refs enable row level security;

drop policy if exists "own attachment_refs" on attachment_refs;
create policy "own attachment_refs" on attachment_refs for all
  using (exists (select 1 from vaults v where v.id = attachment_refs.vault_id and v.user_id = auth.uid()))
  with check (exists (select 1 from vaults v where v.id = attachment_refs.vault_id and v.user_id = auth.uid()));

-- 加密附件的私有 bucket；物件路徑是 `<vaultId>/<attachmentId>`，只有該知識庫的擁有者能讀寫。
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "own vault attachment blobs" on storage.objects;
create policy "own vault attachment blobs" on storage.objects for all to authenticated
  using (
    bucket_id = 'attachments'
    and exists (select 1 from public.vaults v where v.id = (storage.foldername(name))[1] and v.user_id = auth.uid())
  )
  with check (
    bucket_id = 'attachments'
    and exists (select 1 from public.vaults v where v.id = (storage.foldername(name))[1] and v.user_id = auth.uid())
  );
