-- 3d：即時同步需要的 Realtime 設定，以及設計文件 §11「留給 3d」的 4 個競態問題裡，2 個只能在資料庫端
-- 原子化解決的（createVault 非原子、attachment ref 的「沒人用了」判斷與刪檔之間的競態）。
-- 另外 2 個（nextSeq 搶號、pullDoc 讀快照與增量分兩次查詢）不需要改資料庫，改法在 adapters/sync/supabase-sync.ts。
-- 到 Supabase Dashboard → SQL Editor → New query，貼上整份執行即可（可重複執行）。

-- 讓 doc_updates / doc_snapshots 的 INSERT/UPDATE 可以被 Supabase Realtime 推播（core/sync-engine 的
-- SupabaseSync.subscribe 訂閱這兩張表，見設計文件 §5「同步傳輸」）。重複加入同一張表會報錯，所以用
-- exception 區塊吞掉「已經加過」的錯誤，讓整份檔案可以重跑。
do $$
begin
  alter publication supabase_realtime add table doc_updates;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table doc_snapshots;
exception
  when duplicate_object then null;
end $$;

-- 競態 1/4（3c 留下的）：createVault 先寫 vaults 再寫 vault_keys，中間失敗會留下沒有金鑰的孤兒知識庫。
-- 改成一個函式內做兩個 insert，Postgres 函式本身就是一個交易，失敗就整個回滾，不會留下孤兒列。
-- 用 security invoker（預設）而不是 security definer，呼叫端的 auth.uid() 與既有 RLS 原封不動套用。
create or replace function create_vault_with_keys(
  p_vault_id text,
  p_user_id uuid,
  p_wrapped_key_password text,
  p_kdf_params_password jsonb,
  p_wrapped_key_recovery text,
  p_kdf_params_recovery jsonb
) returns void
language plpgsql
security invoker
as $$
begin
  insert into vaults (id, user_id) values (p_vault_id, p_user_id);
  insert into vault_keys (vault_id, user_id, wrapped_key_password, kdf_params_password, wrapped_key_recovery, kdf_params_recovery)
  values (p_vault_id, p_user_id, p_wrapped_key_password, p_kdf_params_password, p_wrapped_key_recovery, p_kdf_params_recovery);
end;
$$;
grant execute on function create_vault_with_keys(text, uuid, text, jsonb, text, jsonb) to authenticated;

-- 競態 2/4（3c 留下的）：deleteAttachmentsForNote 判斷「沒人在用」與刪檔之間，另一台裝置可能插入新參照。
-- 用 pg_advisory_xact_lock 把「同一個 attachment_id 的參照增減」序列化：新增參照（add_attachment_ref）與
-- 回收參照（reap_note_attachment_refs）搶同一把鎖，鎖只在交易內有效，交易結束自動釋放，不需要手動解鎖。
-- 這樣「刪某篇筆記的參照 + 算出哪些 attachment 歸零」是一個交易內完成，不會跟另一台裝置的新增參照交錯。
-- 殘留的極小窗口（這個交易 commit 之後、呼叫端真正刪 Storage 檔案之前，又有新參照插入）留給呼叫端在刪檔前
-- 再查一次確認，這已經是資料庫原子性能收斂到最小的程度（見 adapters/sync/supabase-attachment-sync.ts 的註解）。
create or replace function add_attachment_ref(
  p_vault_id text,
  p_attachment_id text,
  p_note_id text,
  p_size integer
) returns void
language plpgsql
security invoker
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_vault_id || ':' || p_attachment_id, 0));
  insert into attachment_refs (vault_id, attachment_id, note_id, size)
  values (p_vault_id, p_attachment_id, p_note_id, p_size)
  on conflict (vault_id, attachment_id, note_id) do update set size = excluded.size;
end;
$$;
grant execute on function add_attachment_ref(text, text, text, integer) to authenticated;

-- 回傳這篇筆記原本用到、現在已經沒有任何筆記在用的 attachment_id 清單（呼叫端收到清單後才去刪 Storage 檔案）。
create or replace function reap_note_attachment_refs(
  p_vault_id text,
  p_note_id text
) returns table (attachment_id text)
language plpgsql
security invoker
as $$
declare
  ids text[];
begin
  select array_agg(distinct r.attachment_id) into ids
  from attachment_refs r
  where r.vault_id = p_vault_id and r.note_id = p_note_id;

  if ids is null then
    return;
  end if;

  -- 依固定順序（排序後）逐一取鎖，跟 add_attachment_ref 用同一把鎖；固定順序避免兩台裝置同時回收/新增
  -- 不同 attachment 時彼此互相等待造成 deadlock。
  perform pg_advisory_xact_lock(hashtextextended(p_vault_id || ':' || a, 0))
  from unnest(ids) as a
  order by a;

  delete from attachment_refs r where r.vault_id = p_vault_id and r.note_id = p_note_id;

  return query
  select a from unnest(ids) as a
  where not exists (
    select 1 from attachment_refs r2 where r2.vault_id = p_vault_id and r2.attachment_id = a
  );
end;
$$;
grant execute on function reap_note_attachment_refs(text, text) to authenticated;
