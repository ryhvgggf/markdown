-- 4b 審查修正：保護有密碼的連結（規劃見專案 claude/4b-part2-done.md）。需要先執行過 0005。
-- 到 Supabase Dashboard → SQL Editor → New query，貼上整份執行即可（可重複執行）。
--
-- 1. 有密碼的連結，快照只能經由 update_share_snapshot 更新：舊版程式直接寫入的快照只用連結金鑰加密，
--    會讓知道密碼的人也打不開，所以在資料庫擋掉。
-- 2. 改密碼、換新連結時比對「目前的快照內容」（密文的 SHA-256）：別台剛更新過快照就不寫入，
--    避免較新的快照被換回舊的。

create or replace function share_links_touch() returns trigger
language plpgsql
as $$
begin
  if new.ciphertext is distinct from old.ciphertext and new.pw_salt is not distinct from old.pw_salt then
    if new.pw_salt is not null and coalesce(current_setting('notes.share_write', true), '') <> 'on' then
      raise exception 'protected share link: snapshot must be updated with update_share_snapshot' using errcode = '55000';
    end if;
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

-- 擁有者：更新快照（只在密碼設定仍是 p_expected_salt 時）。回傳 ok／changed／not-found。
create or replace function update_share_snapshot(p_id text, p_ciphertext bytea, p_expected_salt text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('notes.share_write', 'on', true);
  update share_links set ciphertext = p_ciphertext
    where id = p_id and pw_salt is not distinct from p_expected_salt;
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

-- 擁有者：設定、更改或移除密碼（p_salt 為空 = 移除），同時換掉密文。
-- 只在密碼設定仍是 p_expected_salt、且快照仍是 p_expected_hash（密文的 SHA-256）時寫入。
create or replace function set_share_password(
  p_id text,
  p_ciphertext bytea,
  p_salt text,
  p_iterations integer,
  p_verifier bytea,
  p_key text,
  p_expected_salt text,
  p_expected_hash bytea
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  update share_links
    set ciphertext = p_ciphertext, pw_salt = p_salt, pw_iterations = p_iterations, pw_verifier = p_verifier, pw_key = p_key
    where id = p_id and pw_salt is not distinct from p_expected_salt and sha256(ciphertext) = p_expected_hash;
  if found then
    return 'ok';
  end if;
  if exists (select 1 from share_links where id = p_id) then
    return 'changed';
  end if;
  return 'not-found';
end;
$$;
revoke all on function set_share_password(text, bytea, text, integer, bytea, text, text, bytea) from public, anon;
grant execute on function set_share_password(text, bytea, text, integer, bytea, text, text, bytea) to authenticated;

-- 換新連結：多比對快照內容（p_expected_hash）。參數改了，先刪掉 0005 的版本。
drop function if exists renew_share_link(text, text, text, bytea, bytea, text, text);
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
  insert into share_links (id, vault_id, note_id, user_id, wrapped_key, ciphertext, created_at, updated_at,
                           expires_at, pw_salt, pw_iterations, pw_verifier, pw_key)
  values (p_new, s.vault_id, s.note_id, s.user_id, p_wrapped_key, p_ciphertext, now(), s.updated_at,
          s.expires_at, s.pw_salt, s.pw_iterations, p_pw_verifier, p_pw_key);
  delete from share_links where id = p_old;
  return 'ok';
end;
$$;
revoke all on function renew_share_link(text, text, text, bytea, bytea, text, text, bytea) from public, anon;
grant execute on function renew_share_link(text, text, text, bytea, bytea, text, text, bytea) to authenticated;

-- Supabase 預設會把新函式授權給 anon；擁有者用的函式明確收回（本來就有 RLS，這只是寫清楚）。
revoke all on function set_share_expiry(text, integer) from public, anon;
grant execute on function set_share_expiry(text, integer) to authenticated;
