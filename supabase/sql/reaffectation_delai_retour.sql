-- =============================================================================
-- RETOUR ARRIÈRE de reaffectation_delai.sql — 13/11/2026
-- 1. arrête la tâche pg_cron D'ABORD ; 2. retire « Traiter → ouvert », l'horloge,
-- les colonnes (agent_depuis, ouvert_le, ouvert_par, pays.fuseau,
-- réglages des entreprises) ; 3. remet historiser_affectation de
-- historique_affectations.sql (sans « delai »).
-- L'HISTORIQUE ÉCRIT RESTE : les lignes « delai » restent valides (la contrainte les
-- garde). Les leads déjà déplacés restent chez leur nouvel agent. Rejouable.
-- =============================================================================
begin;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from cron.job where jobname = 'reaffecter-leads-en-retard') then
    perform cron.unschedule('reaffecter-leads-en-retard');
  end if;
end $$;
commit;

begin;
drop function if exists public.reaffecter_leads_en_retard();
drop function if exists public.marquer_lead_ouvert(uuid);
drop function if exists public.fixer_delai_reaffectation(uuid, integer);
drop trigger if exists trg_zz_agent_depuis on public.commandes;
drop function if exists public.commande_agent_depuis();
alter table public.commandes drop column if exists agent_depuis;
alter table public.commandes drop column if exists ouvert_le;
alter table public.commandes drop column if exists ouvert_par;
drop function if exists public.minutes_ouvrees(timestamptz, timestamptz, text);
alter table public.tenants drop constraint if exists tenants_delai_reaffectation_borne;
alter table public.tenants drop column if exists delai_reaffectation_minutes;
alter table public.tenants drop column if exists reaffectation_depuis;
drop trigger if exists trg_pays_fuseau on public.pays;
drop function if exists public.pays_fuseau();
alter table public.pays drop column if exists fuseau;
drop function if exists public.fuseau_du_pays(text);

-- historiser_affectation : le corps de historique_affectations.sql
create or replace function public.historiser_affectation(
  p_quoi     text,
  p_commande public.commandes,
  p_avant    uuid,
  p_apres    uuid,
  p_creation boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot    uuid := nullif(current_setting('crm.affectation_lot', true), '')::uuid;
  v_acteur uuid := coalesce(auth.uid(), nullif(current_setting('crm.historique_acteur', true), '')::uuid);
  v_via    text;
  v_nom    text;
  v_avant  text;
  v_apres  text;
begin
  -- pg_trigger_depth() vaut ici 1 pour le trigger appelant ; 2 ou plus si
  -- l'écriture vient elle-même d'un trigger (auto_affecter_livreur).
  v_via := case
    when v_lot is not null         then 'affectation'
    when p_creation                then 'creation'
    when pg_trigger_depth() > 1    then 'automatique'
    when auth.uid() is not null    then 'navigateur'
    else 'systeme'
  end;

  if v_acteur is not null then
    select coalesce(
             (select nullif(btrim(a.nom), '') from public.agents a
               where a.user_id = v_acteur and a.tenant_id = p_commande.tenant_id limit 1),
             (select nullif(btrim(ur.nom), '') from public.user_roles ur
               where ur.user_id = v_acteur limit 1),
             (select ur.email from public.user_roles ur
               where ur.user_id = v_acteur limit 1))
      into v_nom;
  end if;

  if p_quoi = 'agent' then
    select nullif(btrim(nom), '') into v_avant from public.agents where id = p_avant;
    select nullif(btrim(nom), '') into v_apres from public.agents where id = p_apres;
  else
    select nullif(btrim(nom), '') into v_avant from public.livreurs where id = p_avant;
    select nullif(btrim(nom), '') into v_apres from public.livreurs where id = p_apres;
  end if;

  insert into public.historique_affectations
    (tenant_id, commande_id, vendeur_id,
     commande_lead_id, commande_tracking, commande_client, commande_produit,
     quoi, avant_id, avant_nom, apres_id, apres_nom,
     fait_par, fait_par_nom, via, lot_id)
  values
    (p_commande.tenant_id, p_commande.id, p_commande.vendeur_id,
     p_commande.lead_id, p_commande.tracking_number, p_commande.client_nom, p_commande.produit,
     p_quoi, p_avant, v_avant, p_apres, v_apres,
     v_acteur, v_nom, v_via, v_lot);
end;
$$;
revoke all on function public.historiser_affectation(text, public.commandes, uuid, uuid, boolean)
  from public, anon, authenticated;
comment on function public.historiser_affectation(text, public.commandes, uuid, uuid, boolean) is null;
-- la contrainte garde « delai » : des lignes l'ont peut-être déjà
do $$ begin
  raise notice 'reaffectation_delai_retour.sql : tâche arrêtée, horloge et colonnes retirées ; l''historique écrit reste.';
end $$;
commit;
