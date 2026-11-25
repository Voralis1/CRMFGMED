-- =============================================================================
-- RETOUR ARRIÈRE de reglement_atomique.sql — 03/11/2026
-- =============================================================================
-- Remet l'état lu en prod le 03/11 :
--   · reglements_garde = le corps du 03/11 (md5 6f5f9bed…, vérifié) : un relevé
--     payé peut de nouveau repasser « en attente » ;
--   · les politiques reglements_insert, reglements_commandes_insert,
--     reglements_commandes_delete, et les droits d'écriture d'authenticated ;
--   · etablir_releve supprimée.
-- Ne touche AUCUN relevé. ⚠ Remettre aussi l'ANCIENNE page (la nouvelle
-- appelle etablir_releve). Rejouable.
-- =============================================================================
begin;

drop function if exists public.etablir_releve(uuid, uuid, uuid[], text, date, date);

create or replace function public.reglements_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;   -- service_role, éditeur SQL : personne à contrôler
  end if;

  if tg_op = 'UPDATE' and old.statut = 'paye' then
    if new.total_ventes   is distinct from old.total_ventes
       or new.net_a_payer is distinct from old.net_a_payer
       or new.nb_commandes is distinct from old.nb_commandes
       or new.vendeur_id  is distinct from old.vendeur_id
       or new.periode_debut is distinct from old.periode_debut
       or new.periode_fin   is distinct from old.periode_fin then
      raise exception 'Ce relevé est déjà payé : ses montants ne peuvent plus changer';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.statut = 'paye' and old.statut <> 'paye'
     and new.date_paiement is null then
    new.date_paiement := now();
  end if;

  return new;
end;
$$;
comment on function public.reglements_garde() is null;

grant insert, truncate on public.reglements to authenticated;
grant insert, update, delete, truncate on public.reglements_commandes to authenticated;

drop policy if exists reglements_insert           on public.reglements;
drop policy if exists reglements_commandes_insert on public.reglements_commandes;
drop policy if exists reglements_commandes_delete on public.reglements_commandes;
create policy reglements_insert on public.reglements for insert to authenticated
  with check (is_super_admin() OR ((tenant_id = get_my_tenant_id()) AND (lower(COALESCE(mon_role(), ''::text)) = ANY (ARRAY['admin'::text, 'manager'::text]))));
create policy reglements_commandes_insert on public.reglements_commandes for insert to authenticated
  with check ((tenant_id = get_my_tenant_id()) AND reglement_modifiable(reglement_id));
create policy reglements_commandes_delete on public.reglements_commandes for delete to authenticated
  using (reglement_modifiable(reglement_id));

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.reglements_garde()'::regprocedure) <> '6f5f9bed9035a2615fd4ab95120f03ee' then
    raise exception 'Retour arrière : reglements_garde n''est pas le corps du 03/11 (md5). Rien n''est changé.';
  end if;
  raise notice 'reglement_atomique : retiré, état du 03/11 remis (md5 vérifié).';
end $$;

commit;
