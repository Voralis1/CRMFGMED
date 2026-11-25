-- =============================================================================
-- Centre d'appel (vue de l'agent) + « Renvoyer en attente » — 28/10/2026
-- =============================================================================
--
-- CE QUE FAIT CE FICHIER (il ne modifie AUCUNE commande) :
--   §1  arrêt si les prérequis manquent ;
--   §2  (retiré le 28/10) : ce fichier ne touche PLUS aux politiques de
--       `appels`. Leur seule définition est appels_responsables.sql ; ce
--       fichier refuse de s'installer (§1) tant qu'elle n'est pas en place,
--       parce que la vue de l'agent (F) compte dessus ;
--   §3  commandes.entree_file : l'heure à laquelle le lead est entré dans la
--       file (sa remontée s'il a été remonté, sinon sa création). L'agent est
--       trié dessus ;
--   §4  « RENVOYER EN ATTENTE » : le retour d'une commande à « Pending »,
--       refusé partout (statut_pending.sql) sauf UN cas — un manager, un admin
--       ou un super admin, tant qu'aucun livreur n'a la commande ;
--   §9  vérification ;
--   §10 répétition : de vraies écritures sur commandes, annulées à la fin.
--       §4 change une fonction qui tourne à CHAQUE écriture sur commandes :
--       une faute là arrête toute l'application. Si la répétition échoue, le
--       fichier s'arrête et l'éditeur SQL n'installe RIEN.
--
-- RETOUR ARRIÈRE (si les écritures sur commandes cassent quand même) :
-- renvoyer_en_attente_retour.sql — remet le corps d'avant de la fonction §4.
--
-- ORDRE : ce fichier D'ABORD, puis `npx supabase functions deploy
-- confirmer-appel`, puis pousser les pages. La page du Centre d'appel trie la
-- file de l'agent sur `entree_file` : sans la colonne, sa liste ne se charge
-- pas (elle le DIT, elle ne s'affiche pas vide).
--
-- Exécutable en entier, et deux fois.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Prérequis
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'commandes'
                    and column_name = 'remonte_le') then
    raise exception 'Lancez d''abord leads_remontes.sql : commandes.remonte_le manque. Rien n''a été installé.';
  end if;
  if to_regclass('public.historique_statuts') is null then
    raise exception 'Lancez d''abord historique_statuts.sql. Rien n''a été installé.';
  end if;
  -- La vue de l'agent promet qu'il ne lit pas les appels déjà passés : la
  -- base doit le garantir avant que les pages ne le disent. Ce fichier ne
  -- DÉFINIT pas ces politiques (une seule définition :
  -- appels_responsables.sql) ; il refuse seulement de s'installer sur une
  -- table encore ouverte — une branche par agent_id ou par rôle est
  -- exactement ce qui laissait passer agents, vendeurs et livreurs.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'appels')
     or exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'appels'
                   and (coalesce(qual, '') ilike '%agent_id%' or coalesce(with_check, '') ilike '%agent_id%'
                        or coalesce(qual, '') ilike '%mon_role%' or coalesce(with_check, '') ilike '%mon_role%')) then
    raise exception 'Lancez d''abord appels_responsables.sql : `appels` est encore lisible au-delà des responsables. Rien n''a été installé.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. commandes.entree_file
-- -----------------------------------------------------------------------------
-- Un lead remonté revient à l'agent « comme neuf » : trié parmi les nouveaux
-- leads par l'heure de sa remontée, pas en tête de liste (ce qui dirait
-- « ceux-là, on les a déjà essayés »). PostgREST ne trie pas sur une
-- expression : d'où une colonne calculée par la base, jamais écrite par
-- personne. Les responsables gardent leur tri (remontés d'abord).
alter table public.commandes
  add column if not exists entree_file timestamptz
  generated always as (coalesce(remonte_le, created_at)) stored;

create index if not exists idx_commandes_entree_file
  on public.commandes (tenant_id, entree_file desc);


-- -----------------------------------------------------------------------------
-- 4. « Renvoyer en attente »
-- -----------------------------------------------------------------------------
-- statut_pending.sql (déjà passé, non modifié) refusait TOUT retour à
-- « Pending ». Nouveau corps de SA fonction, même nom, même trigger
-- (trg_aa_statut_pending) : le retour est permis seulement si
--   1. celui qui le fait est manager ou admin de l'entreprise de la commande,
--      ou super admin — vérifié AVANT tout le reste, pour qu'un vendeur qui
--      essaie depuis la console n'apprenne même pas le nom du livreur ;
--   2. aucune livraison n'existe pour la commande. Une livraison n'existe
--      qu'avec un livreur (check_livraison_coherente), et le stock d'une
--      commande ne bouge QUE par sa livraison (fn_ajuster_stock_livraison) :
--      sans livraison, rien à défaire. Avec, le litige se règle dans
--      Livraisons, dont les statuts ne bougent pas.
-- Qui : auth.uid() pour un compte connecté (navigateur) ; pour confirmer-appel
-- (clé service), le compte qu'enregistrer_appel pose pour CETTE transaction
-- (crm.historique_acteur — un navigateur ne peut pas le poser). Personne
-- d'identifiable (éditeur SQL, import) : refusé.
-- Le motif obligatoire est vérifié par confirmer-appel et finit dans
-- l'historique (« Renvoyé en attente : … »).
--
-- SECURITY DEFINER : les livraisons et les rôles doivent être lus quelle que
-- soit la RLS de celui qui écrit.
--
-- ⚠ Relancer statut_pending.sql remet l'ANCIEN corps (tout retour refusé) :
-- côté sûr, mais le bouton ne marche plus. Relancer alors ce fichier.
--
-- 05/11 — UNE exception (règles de stock, stock_regles.sql) : une commande
-- en « Rupture de stock » ou « Produit non reconnu » repasse « Pending » quand
-- le stock revient / quand son produit est relié, SANS personne — c'est la
-- règle du stock qui le fait, dans sa propre transaction, en posant
-- crm.liberation_rupture = 'oui'. Personne d'autre ne peut poser ce
-- réglage depuis un navigateur ; à la main, la sortie de rupture reste celle
-- d'un responsable, comme tout retour en attente.
create or replace function public.statut_pending_commande()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acteur  uuid;
  v_livreur text;
  v_statut  text;
begin
  if new.statut_confirmation is null or btrim(new.statut_confirmation) = '' then
    new.statut_confirmation := 'Pending';
  end if;

  if tg_op = 'UPDATE'
     and new.statut_confirmation = 'Pending'
     and old.statut_confirmation is not null
     and old.statut_confirmation <> 'Pending' then

    -- 0. La règle du stock libère une commande en pause (05/11, stock_regles.sql).
    if old.statut_confirmation in ('Rupture de stock', 'Produit non reconnu')
       and coalesce(current_setting('crm.liberation_rupture', true), '') = 'oui' then
      return new;
    end if;

    -- 1. Qui
    v_acteur := coalesce(auth.uid(), nullif(current_setting('crm.historique_acteur', true), '')::uuid);
    if v_acteur is null then
      raise exception using
        errcode = 'check_violation',
        message = 'Renvoi en attente refusé : il se fait depuis Commandes (« Renvoyer en attente »), par un manager, un admin ou un super admin.';
    end if;
    if not exists (
      select 1 from public.user_roles ur
        left join public.roles r on r.id = ur.role_id
       where ur.user_id = v_acteur
         and (coalesce(r.nom, ur.role) = 'super_admin'
              or (ur.tenant_id = new.tenant_id and coalesce(r.nom, ur.role) in ('admin', 'manager')))) then
      raise exception using
        errcode = 'check_violation',
        message = 'Renvoi en attente refusé : seuls un manager, un admin ou un super admin peuvent renvoyer une commande en attente.';
    end if;

    -- 2. Aucun livreur
    select coalesce(nullif(btrim(lv.nom), ''), 'sans nom'),
           case l.statut when 'a_preparer' then 'à préparer' when 'expedie' then 'expédiée'
                         when 'livre' then 'livrée' when 'retour' then 'retournée'
                         when 'annule' then 'annulée' else coalesce(l.statut, '?') end
      into v_livreur, v_statut
      from public.livraisons l
      left join public.livreurs lv on lv.id = l.livreur_id
     where l.commande_id = new.id
     order by l.created_at desc nulls last
     limit 1;
    if found then
      raise exception using
        errcode = 'check_violation',
        message = format('Renvoi refusé : le livreur %s a cette commande (livraison %s). Un litige sur la livraison se règle dans Livraisons.', v_livreur, v_statut);
    end if;
  end if;
  return new;
end;
$$;
-- Marque (02/11) : ce fichier définit statut_pending_commande. Les fichiers plus anciens qui
-- en ont une copie la lisent et ne la réécrivent plus.
comment on function public.statut_pending_commande() is 'fichier: renvoyer_en_attente.sql';

revoke all on function public.statut_pending_commande() from public, anon, authenticated;

-- Le trigger existe déjà (statut_pending.sql) ; recréé à l'identique au cas où.
create or replace trigger trg_aa_statut_pending
  before insert or update of statut_confirmation on public.commandes
  for each row execute function public.statut_pending_commande();


-- -----------------------------------------------------------------------------
-- 9. Vérification
-- -----------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'commandes'
                    and column_name = 'entree_file' and is_generated = 'ALWAYS') then
    raise exception 'commandes.entree_file absente ou pas calculée par la base.';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_aa_statut_pending'
                    and tgrelid = 'public.commandes'::regclass and tgenabled <> 'D') then
    raise exception 'trg_aa_statut_pending absent ou désactivé.';
  end if;
  if (select prosrc from pg_proc where oid = 'public.statut_pending_commande()'::regprocedure)
       not ilike '%Renvoi refusé : le livreur%'
     or (select prosrc from pg_proc where oid = 'public.statut_pending_commande()'::regprocedure)
       not ilike '%crm.liberation_rupture%' then
    raise exception 'statut_pending_commande n''a pas le corps de ce fichier.';
  end if;
  raise notice 'renvoyer_en_attente.sql : entree_file en place, renvoi en attente installé. Aucune commande modifiée.';
end $$;


-- -----------------------------------------------------------------------------
-- 10. Répétition : de VRAIES écritures, puis tout est annulé
-- -----------------------------------------------------------------------------
-- Dans l'entreprise de test (17144700…), jamais Fgmed Angola ; à défaut (base
-- de test), la première entreprise qui a un pays. Une commande créée, mise
-- « Unreached », puis :
--   · retour à Pending sans personne (éditeur SQL)          → refusé ;
--   · par un vendeur (compte posé comme le fait confirmer-appel) → refusé,
--     sans nom de livreur ;
--   · par un manager / admin de l'entreprise                → accepté, une
--     ligne d'historique ;
--   · remise « Confirmed », un livreur l'a (livraison)      → refusé, le
--     livreur nommé ;
--   · une commande neuve et un changement ordinaire passent toujours.
-- Tout réussi : le bloc lève « REPETITION_OK », ce qui ANNULE tout ce qu'il a
-- écrit. Sinon le fichier s'arrête avec la raison, et rien n'est installé.
-- Seule trace possible : le compteur des numéros de tracking (FG…) avance.
do $$
declare
  v_t   uuid;
  v_p   uuid;
  v_c   uuid;
  v_resp uuid;
  v_vend uuid;
  v_liv  uuid;
  v_lead text := 'REPETITION-' || replace(gen_random_uuid()::text, '-', '');
  v_msg  text;
  v_n    integer;

  -- l'erreur levée par une écriture, ou NULL si elle passe
  -- (sous-bloc : l'écriture refusée est annulée, le reste continue)
begin
  select id into v_t from public.tenants where id = '17144700-2b95-43fa-9849-9e7a8f35104e';
  if v_t is null then
    select p.tenant_id into v_t from public.pays p order by p.tenant_id limit 1;
  end if;
  select p.id into v_p from public.pays p where p.tenant_id = v_t order by p.nom limit 1;
  select ur.user_id into v_resp from public.user_roles ur left join public.roles r on r.id = ur.role_id
   where ur.tenant_id = v_t and coalesce(r.nom, ur.role) in ('admin', 'manager') order by ur.user_id limit 1;
  select ur.user_id into v_vend from public.user_roles ur left join public.roles r on r.id = ur.role_id
   where ur.tenant_id = v_t and coalesce(r.nom, ur.role) = 'seller' order by ur.user_id limit 1;
  select l.id into v_liv from public.livreurs l where l.tenant_id = v_t order by l.id limit 1;
  if v_t is null or v_p is null or v_resp is null then
    raise exception 'Répétition impossible : il faut une entreprise avec un pays et un manager ou un admin.';
  end if;

  begin
    insert into public.commandes (lead_id, tenant_id, pays_id, client_nom, client_telephone, produit, quantite, prix)
    values (v_lead, v_t, v_p, 'Répétition', '+000', 'Répétition', 1, 0)
    returning id into v_c;
    if (select statut_confirmation from public.commandes where id = v_c) <> 'Pending' then
      raise exception 'une commande neuve n''est pas « Pending »';
    end if;
    update public.commandes set statut_confirmation = 'Unreached' where id = v_c;

    -- sans personne → refusé
    v_msg := null;
    begin
      update public.commandes set statut_confirmation = 'Pending' where id = v_c;
    exception when others then v_msg := sqlerrm;
    end;
    if v_msg is null or v_msg not like 'Renvoi en attente refusé : il se fait depuis Commandes%' then
      raise exception 'sans personne : attendu un refus, obtenu « % »', coalesce(v_msg, 'accepté');
    end if;

    -- un vendeur → refusé
    if v_vend is not null then
      perform set_config('crm.historique_acteur', v_vend::text, true);
      v_msg := null;
      begin
        update public.commandes set statut_confirmation = 'Pending' where id = v_c;
      exception when others then v_msg := sqlerrm;
      end;
      perform set_config('crm.historique_acteur', '', true);
      if v_msg is null or v_msg not like '%seuls un manager, un admin ou un super admin%' then
        raise exception 'vendeur : attendu un refus de rôle, obtenu « % »', coalesce(v_msg, 'accepté');
      end if;
    end if;

    -- un responsable, comme confirmer-appel → accepté, historisé
    perform public.enregistrer_appel(v_c, v_t, v_resp, null, 'Pending', 'Unreached',
                                     'Renvoyé en attente : répétition', null, null, '{}'::jsonb);
    if (select statut_confirmation from public.commandes where id = v_c) <> 'Pending' then
      raise exception 'responsable : le renvoi n''a pas été appliqué';
    end if;
    select count(*) into v_n from public.historique_statuts
     where commande_id = v_c and statut = 'Pending' and statut_precedent = 'Unreached'
       and fait_par = v_resp and note = 'Renvoyé en attente : répétition' and duree_secondes is null;
    if v_n <> 1 then
      raise exception 'responsable : % ligne(s) d''historique pour le renvoi au lieu de 1', v_n;
    end if;

    -- un livreur a la commande → refusé, livreur nommé
    if v_liv is not null then
      update public.commandes set statut_confirmation = 'Unreached' where id = v_c;
      insert into public.livraisons (commande_id, livreur_id, statut, tenant_id)
      values (v_c, v_liv, 'a_preparer', v_t);
      perform set_config('crm.historique_acteur', v_resp::text, true);
      v_msg := null;
      begin
        update public.commandes set statut_confirmation = 'Pending' where id = v_c;
      exception when others then v_msg := sqlerrm;
      end;
      perform set_config('crm.historique_acteur', '', true);
      if v_msg is null or v_msg not like 'Renvoi refusé : le livreur % a cette commande (livraison à préparer)%' then
        raise exception 'livreur : attendu un refus nommant le livreur, obtenu « % »', coalesce(v_msg, 'accepté');
      end if;
    end if;

    raise exception 'REPETITION_OK';
  exception when others then
    if sqlerrm <> 'REPETITION_OK' then
      raise exception 'renvoyer_en_attente.sql — RÉPÉTITION ÉCHOUÉE, rien ne doit être installé : %', sqlerrm;
    end if;
  end;

  if exists (select 1 from public.commandes where lead_id = v_lead)
     or exists (select 1 from public.historique_statuts where commande_lead_id = v_lead) then
    raise exception 'Répétition : des écritures sont restées (elles auraient dû être annulées).';
  end if;
  raise notice 'renvoyer_en_attente.sql : répétition réussie (refus sans personne, refus vendeur, renvoi responsable historisé, refus livreur), tout annulé.';
end $$;
