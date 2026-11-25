-- =============================================================================
-- RETOUR ARRIÈRE de commandes_suppression.sql — 12/11/2026
-- Retire les 2 portes, le journal et les 2 permissions ; remet la politique
-- commandes_delete telle que lue en prod le 12/11 (admin, ceo, manager, super admin).
-- LE JOURNAL EST PERDU ; les commandes déjà supprimées ne reviennent pas. Rejouable.
-- =============================================================================
begin;
drop function if exists public.supprimer_commandes(uuid, uuid[], text);
drop function if exists public.suppression_commande_possible(uuid);
drop function if exists public.droit_suppression_commande(uuid);
drop function if exists public.etat_suppression_commande(uuid);
drop table if exists public.commandes_supprimees;
-- les lignes de role_permissions partent avec (ON DELETE CASCADE)
delete from public.permissions where code in ('supprimer_leads', 'supprimer_commandes');

drop policy if exists commandes_delete on public.commandes;
create policy commandes_delete on public.commandes for delete to authenticated
  using (public.is_super_admin()
         or ((tenant_id = public.get_my_tenant_id())
             and (public.mon_role() = any (array['admin'::text, 'ceo'::text, 'manager'::text]))));
grant delete on public.commandes to authenticated;
do $$ begin
  raise notice 'commandes_suppression_retour.sql : portes, journal et permissions retirés ; suppression directe rouverte comme avant le 12/11.';
end $$;
commit;
