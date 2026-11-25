-- =============================================================================
-- RETOUR ARRIÈRE COMPLET de commandes_statut_lot.sql
-- =============================================================================
--
-- Remet la base dans l'état d'AVANT le fichier (29/10) :
--   1. le trigger d'historique (ecrire_historique_statut) : le corps de
--      production lu le 29/10 par pg_get_functiondef, recopié tel quel
--      ci-dessous — VÉRIFIÉ à la fin : md5(prosrc) = 2e40025a2a103a42be3ddbfc93757c4d,
--      2040 caractères, ou ce fichier s'arrête et n'a rien fait ;
--   2. retire trg_ab_statut_ouvert_livreur (le refus « Non joint / Rappel sur
--      une commande qu'un livreur a ») et trg_suivi_statuts_garde ;
--   3. supprime changer_statut_lot et les fonctions du fichier
--      (remplir_suivi_statuts, recalculer_suivi_statuts, suivi_statuts,
--      est_tentative, est_statut_ouvert, suivi_statuts_garde,
--      statut_ouvert_sans_livreur) ;
--   4. remet la vue v_historique_statuts SANS lot_id (sa définition de
--      historique_statuts.sql §6, celle de production avant le fichier) ;
--   5. supprime historique_statuts.lot_id ;
--   6. remet la contrainte de « via » à ses quatre valeurs — SAUF si des
--      lignes « lot » existent déjà : elles ne se suppriment pas (historique),
--      la contrainte garde alors « lot » et le fichier le dit ;
--   7. supprime les quatre colonnes de commandes (nb_tentatives,
--      derniere_tentative_statut, derniere_tentative_le, derniere_action_le).
-- Ce qui est PERDU : le numéro de lot des lignes « lot » déjà écrites (les
-- lignes restent, avec leur motif et via = « lot »). Le reste se recalcule
-- en relançant commandes_statut_lot.sql.
--
-- LES PAGES DOIVENT REVENIR EN MÊME TEMPS : celles du 29/10 lisent les
-- quatre colonnes et appellent changer_statut_lot. Dans le dossier du projet :
--   git revert <le commit de ce travail>
-- ou, sans commit :
--   git checkout 653f35e -- app/commandes/page.js app/centre-appel/page.js lib/affichageStatut.mjs
--   git rm app/components/FiltreAgent.js
-- puis pousser.
--
-- Une seule transaction (l'éditeur SQL exécute le fichier d'un bloc) :
-- une étape qui échoue n'en laisse aucune faite. Exécutable deux fois, et
-- même si commandes_statut_lot.sql n'a jamais tourné.
-- =============================================================================

-- 02/11 : la mesure du délai de prise en charge (delai_prise_en_charge.sql)
-- appelle est_statut_ouvert, que ce retour supprime. Retirez-la d'abord.
do $$
begin
  if to_regprocedure('public.delai_prise_en_charge(uuid, timestamptz, timestamptz)') is not null then
    raise exception 'Lancez d''abord delai_prise_en_charge_retour.sql (la mesure du délai utilise est_statut_ouvert). Rien n''a été fait.';
  end if;
end $$;

-- 1. Le trigger d'historique, tel qu'en production avant le fichier.
CREATE OR REPLACE FUNCTION public.ecrire_historique_statut()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_via    text;
  v_acteur uuid;
  v_note   text;
  v_duree  integer;
  v_appel  uuid;
  v_nom    text;
begin
  if tg_op = 'UPDATE'
     and new.statut_confirmation is not distinct from old.statut_confirmation then
    return null; -- adresse corrigée, statut inchangé : pas un changement
  end if;

  if v_uid is not null then
    v_via := 'navigateur';
    v_acteur := v_uid;
  elsif coalesce(current_setting('crm.historique_via', true), '') = 'confirmer-appel' then
    v_via := 'confirmer-appel';
    v_acteur := nullif(current_setting('crm.historique_acteur', true), '')::uuid;
    v_note   := nullif(current_setting('crm.historique_note', true), '');
    v_duree  := nullif(current_setting('crm.historique_duree', true), '')::integer;
    v_appel  := nullif(current_setting('crm.historique_appel', true), '')::uuid;
  else
    v_via := 'systeme';
  end if;

  -- Le nom au moment des faits : la fiche agent dans cette entreprise, sinon
  -- le nom du compte, sinon son e-mail.
  if v_acteur is not null then
    select coalesce(
             (select nullif(btrim(a.nom), '') from public.agents a
               where a.user_id = v_acteur and a.tenant_id = new.tenant_id limit 1),
             (select nullif(btrim(ur.nom), '') from public.user_roles ur
               where ur.user_id = v_acteur limit 1),
             (select ur.email from public.user_roles ur
               where ur.user_id = v_acteur limit 1))
      into v_nom;
  end if;

  insert into public.historique_statuts
    (tenant_id, commande_id, vendeur_id,
     commande_lead_id, commande_tracking, commande_client, commande_produit,
     statut_precedent, statut,
     fait_par, fait_par_nom, note, duree_secondes, via, appel_id)
  values
    (new.tenant_id, new.id, new.vendeur_id,
     new.lead_id, new.tracking_number, new.client_nom, new.produit,
     case when tg_op = 'UPDATE' then old.statut_confirmation end,
     new.statut_confirmation,
     v_acteur, v_nom, v_note, v_duree, v_via, v_appel);

  return null;
end;
$function$;
-- Marque (02/11) : le corps remis est celui de historique_statuts.sql — il porte sa marque,
-- pour qu'un nouveau passage de historique_statuts.sql ne s'arrête pas sur une marque fausse.
comment on function public.ecrire_historique_statut() is 'fichier: historique_statuts.sql';

-- 2. Les deux triggers.
drop trigger if exists trg_ab_statut_ouvert_livreur on public.commandes;
drop trigger if exists trg_suivi_statuts_garde on public.commandes;

-- 3. Les fonctions (après le trigger d'historique, qui appelait l'une d'elles).
drop function if exists public.changer_statut_lot(uuid, uuid[], text, text, timestamptz);
drop function if exists public.remplir_suivi_statuts();
drop function if exists public.recalculer_suivi_statuts(uuid);
drop function if exists public.suivi_statuts(uuid);
drop function if exists public.est_tentative(uuid, text, uuid);
drop function if exists public.est_statut_ouvert(uuid, text);
drop function if exists public.suivi_statuts_garde();
drop function if exists public.statut_ouvert_sans_livreur();

-- 4. La vue sans lot_id (« create or replace » ne retire pas une colonne).
drop view if exists public.v_historique_statuts;
create view public.v_historique_statuts
with (security_invoker = off, security_barrier = true) as
select h.id,
       h.tenant_id,
       h.commande_id,
       (h.commande_id is null)  as commande_supprimee,
       h.commande_lead_id,
       h.commande_tracking,
       h.commande_client,
       h.commande_produit,
       h.statut_precedent,
       h.statut,
       case when public.is_super_admin() or public.est_responsable() then h.fait_par end     as fait_par,
       case when public.is_super_admin() or public.est_responsable() then h.fait_par_nom end as fait_par_nom,
       h.note,
       h.duree_secondes,
       h.via,
       h.cree_le
  from public.historique_statuts h
 where public.is_super_admin()
    or (h.tenant_id = public.get_my_tenant_id()
        and (public.est_responsable()
             or (public.mon_role() = 'seller'
                 and coalesce((select c.vendeur_id from public.commandes c
                                where c.id = h.commande_id),
                              h.vendeur_id) = auth.uid())));
revoke all on public.v_historique_statuts from public, anon, authenticated;
grant select on public.v_historique_statuts to authenticated;

-- 5. lot_id (son index part avec elle).
alter table public.historique_statuts drop column if exists lot_id;

-- 6. La contrainte de « via ».
do $$
begin
  if exists (select 1 from public.historique_statuts where via = 'lot') then
    raise notice 'Des lignes « lot » existent : la contrainte de via garde « lot » (ces lignes ne se suppriment pas).';
  else
    alter table public.historique_statuts drop constraint if exists historique_statuts_via_check;
    alter table public.historique_statuts add constraint historique_statuts_via_check
      check (via in ('confirmer-appel', 'navigateur', 'systeme', 'migration'));
  end if;
end $$;

-- 7. Les quatre colonnes (leurs index partent avec elles).
alter table public.commandes drop column if exists nb_tentatives;
alter table public.commandes drop column if exists derniere_tentative_statut;
alter table public.commandes drop column if exists derniere_tentative_le;
alter table public.commandes drop column if exists derniere_action_le;

-- Vérification : sinon, tout est annulé.
do $$
declare
  v_md5 text;
  v_len int;
begin
  select md5(prosrc), length(prosrc) into v_md5, v_len from pg_proc
   where oid = 'public.ecrire_historique_statut()'::regprocedure;
  if v_md5 is distinct from '2e40025a2a103a42be3ddbfc93757c4d' or v_len <> 2040 then
    raise exception 'Retour arrière : le trigger d''historique n''est pas exactement celui d''avant (md5 %, % caractères). Rien n''a été fait.', v_md5, v_len;
  end if;
  if exists (select 1 from pg_trigger where tgname in ('trg_ab_statut_ouvert_livreur', 'trg_suivi_statuts_garde')) then
    raise exception 'Retour arrière : un trigger est encore là. Rien n''a été fait.';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
              ('changer_statut_lot', 'remplir_suivi_statuts', 'recalculer_suivi_statuts', 'suivi_statuts',
               'est_tentative', 'est_statut_ouvert', 'suivi_statuts_garde', 'statut_ouvert_sans_livreur')) then
    raise exception 'Retour arrière : une fonction du fichier est encore là. Rien n''a été fait.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name = 'commandes' and column_name in ('nb_tentatives', 'derniere_tentative_statut', 'derniere_tentative_le', 'derniere_action_le'))
                or (table_name in ('historique_statuts', 'v_historique_statuts') and column_name = 'lot_id'))) then
    raise exception 'Retour arrière : une colonne du fichier est encore là. Rien n''a été fait.';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.v_historique_statuts'::regclass
                  and reloptions @> array['security_invoker=off', 'security_barrier=true'])
     or not has_table_privilege('authenticated', 'public.v_historique_statuts', 'select')
     or has_table_privilege('anon', 'public.v_historique_statuts', 'select') then
    raise exception 'Retour arrière : la vue n''a pas ses options ou ses droits d''avant. Rien n''a été fait.';
  end if;
  raise notice 'Retour arrière complet : trigger d''historique identique à celui d''avant (md5 vérifié), colonnes, lot_id, fonctions et triggers retirés. Remettez les pages (voir l''en-tête).';
end $$;
