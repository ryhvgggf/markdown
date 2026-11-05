-- 多篇合併分享連結（規劃見專案 claude/multi-share-plan.md）。需要先執行過 0004～0006。
-- 到 Supabase Dashboard → SQL Editor → New query，貼上整份執行即可（可重複執行）。
--
-- 1. share_links 新增 note_ids：合併連結裡的所有筆記（依分享頁的順序）；單篇連結為 null。
--    note_id 仍必填，合併連結放第一篇，讓舊版程式不壞。
-- 2. set_share_notes：換「分享的筆記清單」與密文在同一個寫入（比照 0006 比對密碼鹽與快照）。
-- 3. remove_shares_for_notes：永久刪除筆記、停止分享時，合併連結只要含其中一篇就整條停止。
-- 4. renew_share_link：換新連結時一併帶過 note_ids。
-- 5. 筆記清單檢查（share_note_ids_ok）；合併連結的快照不能經由 update_share_snapshot 只換內容。

alter table share_links add column if not exists note_ids text[];

create index if not exists share_links_note_ids_idx on share_links using gin (note_ids);

-- 擁有者：換合併連結的筆記清單與快照（單篇連結回 not-found）。
-- 只在密碼設定仍是 p_expected_salt、且快照仍是 p_expected_hash（密文的 SHA-256）時寫入。回傳 ok／changed／not-found。
create or replace function set_share_notes(
  p_id text,
  p_note_ids text[],
  p_ciphertext bytea,
  p_expected_salt text,
  p_expected_hash bytea
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- 有密碼的連結，快照只能經由這裡或 update_share_snapshot 更新（見 0006 的觸發器）。
  perform set_config('notes.share_write', 'on', true);
  update share_links
    set note_ids = p_note_ids, note_id = p_note_ids[1], ciphertext = p_ciphertext
    where id = p_id
      and note_ids is not null
      and pw_salt is not distinct from p_expected_salt
      and sha256(ciphertext) = p_expected_hash;
  if found then
    perform set_config('notes.share_write', '', true);
    return 'ok';
  end if;
  perform set_config('notes.share_write', '', true);
  if exists (select 1 from share_links where id = p_id and note_ids is not null) then
    return 'changed';
  end if;
  return 'not-found';
end;
$$;
revoke all on function set_share_notes(text, text[], bytea, text, bytea) from public, anon;
grant execute on function set_share_notes(text, text[], bytea, text, bytea) to authenticated;

-- 擁有者：停止這些筆記的所有連結（單篇，以及含其中任何一篇的合併連結）。
create or replace function remove_shares_for_notes(p_vault text, p_note_ids text[])
returns void
language sql
security invoker
set search_path = public
as $$
  delete from share_links
    where vault_id = p_vault
      and (note_id = any(p_note_ids) or note_ids && p_note_ids);
$$;
revoke all on function remove_shares_for_notes(text, text[]) from public, anon;
grant execute on function remove_shares_for_notes(text, text[]) to authenticated;

-- 換新連結：沿用 0006 的比對，多帶 note_ids。
create or replace function renew_share_link(
  p_old text,
  p_new text,
  p_wrapped_key text,
  p_ciphertext bytea,
  p_pw_verifier bytea,
  p_pw_key text,
  p_expected_salt text,
  p_expected_hash bytea
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  s share_links%rowtype;
begin
  select * into s from share_links where id = p_old for update;
  if not found then
    return 'not-found';
  end if;
  if s.pw_salt is distinct from p_expected_salt or sha256(s.ciphertext) is distinct from p_expected_hash then
    return 'changed';
  end if;
  insert into share_links (id, vault_id, note_id, note_ids, user_id, wrapped_key, ciphertext, created_at, updated_at,
                           expires_at, pw_salt, pw_iterations, pw_verifier, pw_key)
  values (p_new, s.vault_id, s.note_id, s.note_ids, s.user_id, p_wrapped_key, p_ciphertext, now(), s.updated_at,
          s.expires_at, s.pw_salt, s.pw_iterations, p_pw_verifier, p_pw_key);
  delete from share_links where id = p_old;
  return 'ok';
end;
$$;
revoke all on function renew_share_link(text, text, text, bytea, bytea, text, text, bytea) from public, anon;
grant execute on function renew_share_link(text, text, text, bytea, bytea, text, text, bytea) to authenticated;

-- 審查補強：
-- (a) 筆記清單的檢查改用函式：陣列從 1 開始、不重複、每個 id 1 到 64 字（檢查條件不能用子查詢）。
create or replace function share_note_ids_ok(p_ids text[], p_first text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    array_ndims(p_ids) = 1
    and array_lower(p_ids, 1) = 1
    and cardinality(p_ids) between 1 and 30
    and array_position(p_ids, null) is null
    and p_ids[1] = p_first
    and not exists (select 1 from unnest(p_ids) x where length(x) not between 1 and 64)
    and (select count(distinct x) from unnest(p_ids) x) = cardinality(p_ids),
    false);
$$;
alter table share_links drop constraint if exists share_links_note_ids;
alter table share_links add constraint share_links_note_ids check (note_ids is null or share_note_ids_ok(note_ids, note_id));

-- (b) 合併連結的快照只能和筆記清單一起換（set_share_notes），舊版程式的「更新快照」不能只換內容。
create or replace function update_share_snapshot(p_id text, p_ciphertext bytea, p_expected_salt text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('notes.share_write', 'on', true);
  update share_links set ciphertext = p_ciphertext
    where id = p_id and note_ids is null and pw_salt is not distinct from p_expected_salt;
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
revoke all on function update_share_snapshot(text, bytea, text) from public, anon;
grant execute on function update_share_snapshot(text, bytea, text) to authenticated;
