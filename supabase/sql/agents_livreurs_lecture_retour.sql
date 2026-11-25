-- =============================================================================
-- RETOUR ARRIÈRE de agents_livreurs_lecture.sql
-- =============================================================================
-- Remet les politiques de lecture de production lues le 30/10, mot pour mot :
--   lecture_agents / lecture_livreurs : (tenant_id = get_my_tenant_id()) OR is_super_admin()
-- (toute l'entreprise lit les deux listes — y compris vendeurs et livreurs).
-- Les écritures ne sont pas touchées. Exécutable deux fois, et même si le
-- fichier n'a jamais tourné.
-- LA PAGE : Commandes (vendeur) n'affiche plus l'agent depuis le 30/10 ;
-- le retour ne la change pas (rien ne s'y lit de faux).
-- =============================================================================
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
            where schemaname = 'public' and tablename in ('agents', 'livreurs') and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy lecture_agents on public.agents
  for select to authenticated
  using ((tenant_id = public.get_my_tenant_id()) or public.is_super_admin());

create policy lecture_livreurs on public.livreurs
  for select to authenticated
  using ((tenant_id = public.get_my_tenant_id()) or public.is_super_admin());

do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in ('agents', 'livreurs') and cmd = 'SELECT') <> 2
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('agents', 'livreurs')
                 and cmd = 'SELECT' and qual like '%seller%') then
    raise exception 'Retour incomplet : les politiques de lecture ne sont pas celles d''avant.';
  end if;
  raise notice 'Retour fait : agents et livreurs relisibles par toute l''entreprise, comme avant le 30/10.';
end $$;
