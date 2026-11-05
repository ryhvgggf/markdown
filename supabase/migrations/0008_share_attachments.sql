-- 4d 分享附件（規劃見專案 claude/share-attachments-plan.md）。需要先執行過 0007。
-- 到 Supabase Dashboard → SQL Editor → New query，貼上整份執行即可（可重複執行）。
-- 跳出 destructive 警告（drop function）時按確認。
--
-- 1. 私有 bucket `share-files`：物件路徑 `<shareId>/<隨機名稱>`，內容是加密過的附件（金鑰只在加密的快照裡）。
-- 2. share_folders：每條連結的附件資料夾屬於誰。資料夾比連結活得久：連結停止或永久刪除後，
--    擁有者仍能刪掉裡面的檔案，再刪資料夾。
-- 3. 開連結的人（不用登入）只能讀「連結還在、沒過期」的資料夾裡的檔案。
-- 4. update_share_snapshot 多比對目前快照（p_expected_hash，可省略）：更新快照會刪掉不再用的附件，
--    不能把別台剛寫入的快照蓋掉。

create table if not exists share_folders (
  share_id text primary key check (share_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table share_folders enable row level security;
-- 擁有者可以讀、刪自己的資料夾；新增只經由 claim_share_folder（要檢查連結不是別人的）。
drop policy if exists "own share folders" on share_folders;
drop policy if exists "own share folders: read" on share_folders;
drop policy if exists "own share folders: delete" on share_folders;
create policy "own share folders: read" on share_folders for select to authenticated using (user_id = auth.uid());
create policy "own share folders: delete" on share_folders for delete to authenticated using (user_id = auth.uid());
revoke all on share_folders from anon;

-- 擁有者：取得這條連結的附件資料夾（已經是自己的就沒事）。回傳 ok／taken。
create or replace function claim_share_folder(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from share_links where id = p_id and user_id <> me) then
    return 'taken';
  end if;
  insert into share_folders (share_id, user_id) values (p_id, me) on conflict (share_id) do nothing;
  if exists (select 1 from share_folders where share_id = p_id and user_id = me) then
    return 'ok';
  end if;
  return 'taken';
end;
$$;
revoke all on function claim_share_folder(text) from public, anon;
grant execute on function claim_share_folder(text) to authenticated;

-- 擁有者：連結已經不在的資料夾（建立超過一小時，避免刪到正在建立中的連結）。
create or replace function orphan_share_folders()
returns setof text
language sql
security invoker
set search_path = public
as $$
  select f.share_id from share_folders f
    where f.user_id = auth.uid()
      and f.created_at < now() - interval '1 hour'
      and not exists (select 1 from share_links l where l.id = f.share_id);
$$;
revoke all on function orphan_share_folders() from public, anon;
grant execute on function orphan_share_folders() to authenticated;

-- 開連結的人：這個資料夾的檔案現在能不能讀（連結存在且沒過期）。只回 true／false。
create or replace function share_files_open(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from share_links where id = p_id and (expires_at is null or expires_at > now()));
$$;
revoke all on function share_files_open(text) from public;
grant execute on function share_files_open(text) to anon, authenticated;

-- bucket：私有、單檔上限 21 MB（程式限制 20 MB，加上加密的 28 位元組）。
insert into storage.buckets (id, name, public, file_size_limit)
values ('share-files', 'share-files', false, 22020096)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "share files: owner" on storage.objects;
create policy "share files: owner" on storage.objects for all to authenticated
  using (
    bucket_id = 'share-files'
    and exists (select 1 from public.share_folders f where f.share_id = (storage.foldername(name))[1] and f.user_id = auth.uid())
  )
  with check (
    bucket_id = 'share-files'
    and name ~ '^[A-Za-z0-9_-]{16,64}/[A-Za-z0-9_-]{22}$'
    and exists (select 1 from public.share_folders f where f.share_id = (storage.foldername(name))[1] and f.user_id = auth.uid())
  );

drop policy if exists "share files: viewers read" on storage.objects;
create policy "share files: viewers read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'share-files' and public.share_files_open((storage.foldername(name))[1]));

-- 更新快照：多比對目前快照（省略 p_expected_hash 時同 0007，讓還開著的舊版程式照常運作）。
drop function if exists update_share_snapshot(text, bytea, text);
create or replace function update_share_snapshot(p_id text, p_ciphertext bytea, p_expected_salt text, p_expected_hash bytea default null)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('notes.share_write', 'on', true);
  update share_links set ciphertext = p_ciphertext
    where id = p_id
      and note_ids is null
      and pw_salt is not distinct from p_expected_salt
      and (p_expected_hash is null or sha256(ciphertext) = p_expected_hash);
  if found then
    perform set_config('notes.share_write', '', true);
    return 'ok';
  end if;
  perform set_config('notes.share_write', '', true);
  if exists (select 1 from share_links where id = p_id) then
    return 'changed';
  end if;
  return 'not-found';
end;
$$;
revoke all on function update_share_snapshot(text, bytea, text, bytea) from public, anon;
grant execute on function update_share_snapshot(text, bytea, text, bytea) to authenticated;
