-- 4b：分享連結的到期、密碼、換新連結（規劃見專案 claude/4b-plan.md）。
-- 到 Supabase Dashboard → SQL Editor → New query，貼上整份執行即可（可重複執行）。需要先執行過 0004。
--
-- 密碼：連結 # 後的金鑰＋密碼一起算出「內容金鑰」與「通行證」（都在瀏覽器裡算）。
-- 伺服器只存通行證的 SHA-256（pw_verifier）；密碼對了（通行證對得上）才回密文。密碼本身不存在任何地方。
-- pw_key 是擁有者用的：用知識庫主金鑰包起來的密碼衍生值，讓擁有者更新快照、換新連結時不用再輸入密碼。

alter table share_links add column if not exists expires_at timestamptz;
alter table share_links add column if not exists pw_salt text;
alter table share_links add column if not exists pw_iterations integer;
alter table share_links add column if not exists pw_verifier bytea;
alter table share_links add column if not exists pw_key text;

-- 密碼欄位要嘛全有、要嘛全空。
alter table share_links drop constraint if exists share_links_password_fields;
alter table share_links add constraint share_links_password_fields check (
  (pw_salt is null and pw_iterations is null and pw_verifier is null and pw_key is null)
  or (
    pw_salt is not null and length(pw_salt) between 16 and 64
    and pw_iterations between 100000 and 10000000
    and pw_verifier is not null and octet_length(pw_verifier) = 32
    and pw_key is not null and length(pw_key) <= 256
  )
);
alter table share_links drop constraint if exists share_links_wrapped_key_size;
alter table share_links add constraint share_links_wrapped_key_size check (length(wrapped_key) <= 256);

create index if not exists share_links_vault_idx on share_links (vault_id, created_at desc);

-- 「快照時間」只在快照內容換掉時更新：改到期不算；改密碼／移除密碼會重新加密，但內容沒變，也不算。
create or replace function share_links_touch() returns trigger
language plpgsql
as $$
begin
  if new.ciphertext is distinct from old.ciphertext and new.pw_salt is not distinct from old.pw_salt then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

-- 開連結的人（不用登入）第一步：回傳狀態。
--   ok：沒設密碼、沒過期，附密文。
--   expired：已過期（不給密文）。
--   password：要密碼（不給密文，只給算通行證需要的鹽與次數）。
--   不存在：不回傳任何列。
-- 回傳型別改了，要先刪掉 0004 的版本。
drop function if exists get_shared_snapshot(text);
create function get_shared_snapshot(p_id text)
returns table (status text, ciphertext bytea, pw_salt text, pw_iterations integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s share_links%rowtype;
begin
  select * into s from share_links where id = p_id;
  if not found then
    return;
  end if;
  if s.expires_at is not null and s.expires_at <= now() then
    return query select 'expired'::text, null::bytea, null::text, null::integer;
  elsif s.pw_verifier is not null then
    return query select 'password'::text, null::bytea, s.pw_salt, s.pw_iterations;
  else
    return query select 'ok'::text, s.ciphertext, null::text, null::integer;
  end if;
end;
$$;
revoke all on function get_shared_snapshot(text) from public;
grant execute on function get_shared_snapshot(text) to anon, authenticated;

-- 開連結的人第二步（有密碼時）：通行證對了才回密文。沒有次數限制（使用者決定不鎖定）。
--   ok：附密文；pw_salt 為空表示密碼在這段時間被移除了（用連結金鑰就能解開）。
--   wrong／expired；不存在：不回傳任何列。
create or replace function open_protected_snapshot(p_id text, p_proof bytea)
returns table (status text, ciphertext bytea, pw_salt text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s share_links%rowtype;
begin
  select * into s from share_links where id = p_id;
  if not found then
    return;
  end if;
  if s.expires_at is not null and s.expires_at <= now() then
    return query select 'expired'::text, null::bytea, null::text;
  elsif s.pw_verifier is null then
    return query select 'ok'::text, s.ciphertext, null::text;
  elsif p_proof is null or octet_length(p_proof) <> 32 or sha256(p_proof) <> s.pw_verifier then
    return query select 'wrong'::text, null::bytea, null::text;
  else
    return query select 'ok'::text, s.ciphertext, s.pw_salt;
  end if;
end;
$$;
revoke all on function open_protected_snapshot(text, bytea) from public;
grant execute on function open_protected_snapshot(text, bytea) to anon, authenticated;

-- 擁有者：設定到期（用資料庫時間，不信任裝置時鐘）。p_seconds 為空 = 永久。
-- security invoker：照 RLS，只能改自己的連結；找不到（或不是自己的）不回傳任何列。
create or replace function set_share_expiry(p_id text, p_seconds integer)
returns table (expires_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v timestamptz;
begin
  if p_seconds is not null and (p_seconds <= 0 or p_seconds > 366 * 86400) then
    raise exception 'invalid expiry' using errcode = '22023';
  end if;
  update share_links s
    set expires_at = case when p_seconds is null then null else now() + make_interval(secs => p_seconds) end
    where s.id = p_id
    returning s.expires_at into v;
  if not found then
    return;
  end if;
  return query select v;
end;
$$;
revoke all on function set_share_expiry(text, integer) from public;
grant execute on function set_share_expiry(text, integer) to authenticated;

-- 擁有者：換新連結。同一個交易裡建立新的一列（沿用筆記、到期、密碼設定、快照時間）並刪掉舊的。
-- p_expected_salt：新密文是照哪個密碼設定算的；期間被別台改過密碼就回 changed，什麼都不做。
-- security invoker：新列也要通過 RLS（自己的知識庫、自己名下）。
create or replace function renew_share_link(
  p_old text,
  p_new text,
  p_wrapped_key text,
  p_ciphertext bytea,
  p_pw_verifier bytea,
  p_pw_key text,
  p_expected_salt text
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
  if s.pw_salt is distinct from p_expected_salt then
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
revoke all on function renew_share_link(text, text, text, bytea, bytea, text, text) from public;
grant execute on function renew_share_link(text, text, text, bytea, bytea, text, text) to authenticated;
