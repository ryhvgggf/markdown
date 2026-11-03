-- 4a：唯讀快照連結（規劃見專案 claude/4a-plan.md）。
-- 伺服器只存密文：快照用每條連結自己的分享金鑰加密，金鑰在連結 # 後面，不會送到伺服器；
-- 雲端只存「用知識庫主金鑰包起來的分享金鑰」（wrapped_key），讓擁有者在任何一台裝置都能再次複製連結。
-- 到 Supabase Dashboard → SQL Editor → New query，貼上整份執行即可（可重複執行）。

-- share_links 在 0001 建好但從沒用過。沒有密文的舊列沒有任何用處，先清掉，才能把新欄位設成必填。
alter table share_links add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table share_links add column if not exists ciphertext bytea;
alter table share_links add column if not exists wrapped_key text;
alter table share_links add column if not exists updated_at timestamptz not null default now();
delete from share_links where ciphertext is null or wrapped_key is null or user_id is null;
alter table share_links alter column user_id set not null;
alter table share_links alter column ciphertext set not null;
alter table share_links alter column wrapped_key set not null;

-- 連結 id 是 128 位元隨機值（base64url 22 字）；密文上限約 2 MB（程式端壓縮後 2 MB，加上加密的 28 位元組）。
alter table share_links drop constraint if exists share_links_id_format;
alter table share_links add constraint share_links_id_format check (id ~ '^[A-Za-z0-9_-]{16,64}$');
alter table share_links drop constraint if exists share_links_ciphertext_size;
alter table share_links add constraint share_links_ciphertext_size check (octet_length(ciphertext) <= 2097152 + 64);

create index if not exists share_links_note_idx on share_links (vault_id, note_id);

-- 更新快照時由資料庫記時間（不信任裝置時鐘）。
create or replace function share_links_touch() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists share_links_touch on share_links;
create trigger share_links_touch before update on share_links
  for each row execute function share_links_touch();

-- 擁有者：只能讀寫自己知識庫裡、自己名下的連結。
drop policy if exists "own share_links" on share_links;
create policy "own share_links" on share_links for all
  using (
    auth.uid() = user_id
    and exists (select 1 from vaults v where v.id = share_links.vault_id and v.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from vaults v where v.id = share_links.vault_id and v.user_id = auth.uid())
  );

-- 開連結的人（不用登入）：不開放直接查表（否則可以列出所有連結），只能用 id 取一列的密文。
-- security definer：以建立者權限執行、略過 RLS；只回傳 ciphertext 與 updated_at，不回傳 vault／note／user。
create or replace function get_shared_snapshot(p_id text)
returns table (ciphertext bytea, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.ciphertext, s.updated_at from share_links s where s.id = p_id;
$$;
revoke all on function get_shared_snapshot(text) from public;
grant execute on function get_shared_snapshot(text) to anon, authenticated;
