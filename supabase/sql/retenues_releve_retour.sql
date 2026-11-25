-- =============================================================================
-- RETOUR ARRIÈRE de retenues_releve.sql — 09/11/2026
-- À lancer APRÈS reglement_atomique_retour_09_11.sql (il le vérifie).
-- Retire : les ajustements (table), le crédit d'expédition et le transfert
-- (fonctions) ; remet fixer_charges_releve de frais_vendeurs.sql (les charges à
-- la main). GARDE les colonnes et leurs valeurs : les montants des relevés ne
-- bougent pas (frais_divers garde le total des ajustements).
-- ⚠ Les lignes d'ajustement (note, qui, quand) sont PERDUES : seul leur total
-- reste dans les charges du relevé. Rejouable.
-- =============================================================================
begin;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'etablir_releve' and prosrc like '%recalculer_releve%') then
    raise exception 'retenues_releve_retour.sql : lancez d''abord reglement_atomique_retour_09_11.sql. Rien n''est retiré.';
  end if;
end $$;

drop function if exists public.fixer_credit_expedition(uuid, numeric, text, numeric, numeric);
drop function if exists public.fixer_credit_expedition(uuid, date, numeric, numeric, text);
drop function if exists public.fixer_credit_expedition(uuid, date, numeric, numeric, numeric, text);
drop function if exists public.ajouter_ajustement(uuid, text, numeric, boolean, text);
drop function if exists public.retirer_ajustement(uuid);
drop function if exists public.releve_modifiable(uuid);
drop function if exists public.recalculer_releve(uuid);
drop function if exists public.transfert_applicable(uuid, uuid, uuid, date);
drop function if exists public.calcul_net_releve(numeric, numeric, numeric, numeric);
drop table if exists public.reglements_ajustements;

create or replace function public.fixer_charges_releve(p_reglement uuid, p_montant numeric, p_note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare r public.reglements%rowtype; v_net numeric;
begin
  select * into r from public.reglements where id = p_reglement for update;
  if not found then
    raise exception 'Relevé introuvable.';
  end if;
  if not (public.is_super_admin()
          or (r.tenant_id = public.get_my_tenant_id() and public.a_la_permission('gerer_reglements'))) then
    raise exception 'Votre rôle ne permet pas de modifier un relevé.' using errcode = '42501';
  end if;
  if r.statut = 'paye' then
    raise exception 'Ce relevé est déjà payé : ses charges ne peuvent plus changer.';
  end if;
  if p_montant is null or p_montant < 0 then
    raise exception 'Montant des charges invalide.';
  end if;
  if p_montant > 0 and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Écrivez à quoi correspondent ces charges (note obligatoire).';
  end if;
  v_net := r.total_ventes - r.frais_confirmation - r.frais_livraison - r.frais_upsell - r.frais_service - p_montant;
  perform set_config('crm.reglement_calcul', 'oui', true);
  update public.reglements
     set frais_divers = p_montant,
         frais_divers_note = nullif(btrim(coalesce(p_note, '')), ''),
         net_a_payer = v_net
   where id = r.id;
  perform set_config('crm.reglement_calcul', '', true);
  return v_net;
end;
$$;
revoke all on function public.fixer_charges_releve(uuid, numeric, text) from public, anon;
grant execute on function public.fixer_charges_releve(uuid, numeric, text) to authenticated, service_role;
comment on function public.fixer_charges_releve(uuid, numeric, text) is 'fichier: frais_vendeurs.sql';

do $$
begin
  if to_regclass('public.reglements_ajustements') is not null
     or to_regprocedure('public.recalculer_releve(uuid)') is not null
     or md5((select prosrc from pg_proc where oid = to_regprocedure('public.fixer_charges_releve(uuid, numeric, text)'))) <> '40dc37600cf8b026b09a9bf0d4532a1e' then
    raise exception 'retenues_releve_retour.sql : le retour n''est pas complet. Rien n''est retiré.';
  end if;
  raise notice 'retenues_releve_retour.sql : retiré ; charges à la main remises (frais_vendeurs.sql). Colonnes et montants gardés.';
end $$;

commit;
