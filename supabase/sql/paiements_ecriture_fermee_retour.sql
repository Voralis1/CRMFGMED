-- =============================================================================
-- RETOUR ARRIÈRE de paiements_ecriture_fermee.sql — 13/11/2026
-- Remet les 3 règles d'écriture telles que lues en prod le 13/11 et les droits
-- d'écriture du navigateur (le livreur et les responsables, CEO compris, écrivent
-- de nouveau les paiements depuis la console). Rejouable.
-- =============================================================================
begin;
drop policy if exists paiements_insert on public.paiements;
drop policy if exists paiements_update on public.paiements;
drop policy if exists paiements_delete on public.paiements;
create policy paiements_insert on public.paiements for insert to authenticated
  with check (public.is_super_admin() or ((tenant_id = public.get_my_tenant_id())
              and (public.est_responsable() or (livreur_id = public.mon_livreur_id()))));
create policy paiements_update on public.paiements for update to authenticated
  using (public.is_super_admin() or ((tenant_id = public.get_my_tenant_id())
         and (public.est_responsable() or (livreur_id = public.mon_livreur_id()))))
  with check (public.is_super_admin() or (tenant_id = public.get_my_tenant_id()));
create policy paiements_delete on public.paiements for delete to authenticated
  using (public.is_super_admin() or ((tenant_id = public.get_my_tenant_id()) and public.est_responsable()));
grant insert, update, delete on public.paiements to authenticated;
do $$ begin
  raise notice 'paiements_ecriture_fermee_retour.sql : écriture des paiements rouverte au navigateur, comme avant le 13/11.';
end $$;
commit;
