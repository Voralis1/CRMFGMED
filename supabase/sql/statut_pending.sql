-- =============================================================================
-- « Pending » devient un vrai statut — 27/10/2026 — FICHIER 1 SUR 2
-- =============================================================================
--
-- AVANT : un lead que personne n'a touché, c'était statut_confirmation IS NULL.
-- APRÈS : c'est le statut « Pending » (code `pending`), une ligne de `statuts`
-- comme les sept autres, ferme_le_lead = false.
--
-- LA RÈGLE NE DÉPEND PAS DE LA LIGNE. Ce qui est écrit sur la commande est
-- le TEXTE constant « Pending », posé par la base (§2). Une entreprise sans
-- ligne Pending (creer-tenant ne crée aucun statut — trou connu, hors de ce
-- fichier) a quand même des leads « Pending », et les écrans les trouvent
-- par ce texte. La ligne ne sert qu'à l'affichage (nom, couleur).
--
-- CE QUE FAIT CE FICHIER (il ne modifie AUCUNE commande existante) :
--   §1  la ligne « Pending » dans chaque entreprise qui n'en a pas ;
--   §2  trigger sur commandes : un statut NULL (ou vide) devient « Pending »,
--       par tous les chemins — l'API (import.ts écrit null en clair), l'import
--       CSV et la saisie manuelle (qui n'écrivent rien), l'éditeur SQL ;
--       et un lead DÉJÀ traité ne revient jamais à « Pending » (décision du
--       27/10 : on rouvre un lead en lui donnant un statut ouvert, puis on le
--       remonte — un seul chemin de retour dans la file, pas deux) ;
--   §3  la ligne « Pending » ne se renomme pas, ne se supprime pas, ne ferme
--       pas le lead et n'envoie pas au livreur : les écrans la cherchent par
--       son nom ;
--   §4  choisir_agent compte la charge sur « Pending » (il comptait IS NULL :
--       après le rattrapage, tous les agents auraient eu 0 lead en attente et
--       la répartition serait devenue du pur hasard) ;
--   §5  stats_dashboard : « Pending » compte « en attente » (il tombait sinon
--       dans « autre » et le KPI passait à 0) ; la part « En file » s'appelle
--       « Pending ». Corps de PRODUCTION du 27/10, deux lignes changées.
--   §6  vérification.
--
-- Tant que le fichier 2 n'est pas passé, les commandes existantes restent à
-- NULL : tout ce qui est modifié ici lit NULL ET « Pending ».
--
-- Exécutable en entier, et deux fois.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. La ligne « Pending » dans chaque entreprise
-- -----------------------------------------------------------------------------
-- pays_id NULL : vaut pour tous les pays, comme les sept. L'index unique
-- (tenant_id, pays_id, code) ne protège pas les lignes à pays NULL (deux NULL
-- ne se heurtent pas) : d'où le « not exists ».
insert into public.statuts (nom, code, couleur, type, pays_id, tenant_id,
                            declenche_assignation, necessite_rappel, ferme_le_lead)
select 'Pending', 'pending', '#C9C1B1', 'appel', null, t.id, false, false, false
  from public.tenants t
 where not exists (select 1 from public.statuts s
                    where s.tenant_id = t.id and (s.code = 'pending' or lower(btrim(s.nom)) = 'pending'));


-- -----------------------------------------------------------------------------
-- 2. Sur commandes : NULL → « Pending », et pas de retour à « Pending »
-- -----------------------------------------------------------------------------
-- Pas d'exemption pour auth.uid() NULL : la clé service (import-commande,
-- confirmer-appel) et l'éditeur SQL passent par la même règle.
-- GARDE (02/11) : statut_pending_commande est définie aujourd'hui par renvoyer_en_attente.sql.
-- Ce fichier ne la réécrit que si elle manque, n'a pas de marque, porte la
-- sienne ou celle d'un fichier plus ancien. Marquée par un fichier plus
-- récent → gardée telle quelle, avec un avis (rien n'échoue).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.statut_pending_commande()'), 'pg_proc');
begin
  if v_marque in ('fichier: renvoyer_en_attente.sql') then
    raise notice 'statut_pending.sql : statut_pending_commande gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.statut_pending_commande()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.statut_confirmation is null or btrim(new.statut_confirmation) = '' then
    new.statut_confirmation := 'Pending';
  end if;

  if tg_op = 'UPDATE'
     and new.statut_confirmation = 'Pending'
     and old.statut_confirmation is not null
     and old.statut_confirmation <> 'Pending' then
    raise exception using
      errcode = 'check_violation',
      message = 'Un lead déjà traité ne revient pas à « Pending » (il était « '
                || old.statut_confirmation || ' »).',
      hint = 'Donnez-lui un statut ouvert (Unreached, Reminder), puis remontez-le dans la file.';
  end if;
  return new;
end;
$$
$def$;
  comment on function public.statut_pending_commande() is 'fichier: statut_pending.sql';
end $garde$;

-- « trg_aa » : passe AVANT les autres triggers BEFORE (ordre alphabétique),
-- pour qu'aucun ne voie jamais un statut NULL.
create or replace trigger trg_aa_statut_pending
  before insert or update of statut_confirmation on public.commandes
  for each row execute function public.statut_pending_commande();


-- -----------------------------------------------------------------------------
-- 3. La ligne « Pending » est fixe
-- -----------------------------------------------------------------------------
-- La couleur peut changer. Le nom, le code et les deux drapeaux non : les
-- écrans et les fonctions cherchent « Pending » par son nom, et un « Pending »
-- qui fermerait le lead ou l'enverrait au livreur n'aurait plus de sens.
-- 30/10 : MÊME CORPS que statuts_entreprise.sql §5 (la ligne part quand SON
-- entreprise est supprimée — la cascade de statuts_tenant_id_fkey). Changer
-- l'un, changer l'autre : relancer ce fichier ne doit pas défaire l'autre.
create or replace function public.statut_pending_fige()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.code = 'pending' then
    if tg_op = 'DELETE' then
      -- Son entreprise vient d'être supprimée (cascade de statuts_tenant_id_fkey) :
      -- la ligne part avec elle.
      if old.tenant_id is not null
         and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
        return old;
      end if;
      raise exception 'Le statut « Pending » ne se supprime pas : c''est l''état d''un lead que personne n''a encore traité.';
    end if;
    if new.nom is distinct from old.nom or new.code is distinct from old.code
       or new.ferme_le_lead or new.declenche_assignation or new.pays_id is not null then
      raise exception 'Le statut « Pending » ne se renomme pas et ne ferme pas le lead (seule sa couleur peut changer).';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace trigger trg_statut_pending_fige
  before update or delete on public.statuts
  for each row execute function public.statut_pending_fige();


-- -----------------------------------------------------------------------------
-- 4. choisir_agent : la charge = les leads « Pending » de l'agent
-- -----------------------------------------------------------------------------
-- Corps de production du 27/10, une ligne changée. Droits gardés
-- (create or replace).
create or replace function public.choisir_agent(p_tenant uuid, p_pays uuid)
returns uuid
language sql
security definer
set search_path to 'public'
as $function$
  select a.id
  from public.agents a
  join public.user_roles ur on ur.user_id = a.user_id
  where a.tenant_id = p_tenant
    and a.pays_id = p_pays
    and a.actif = true
    and lower(ur.role) = 'agent'
  order by
    (select count(*) from public.commandes c
      where c.agent_id = a.id
        and coalesce(c.statut_confirmation, 'Pending') = 'Pending'),
    random()
  limit 1
$function$;


-- -----------------------------------------------------------------------------
-- 5. stats_dashboard — corps de PRODUCTION du 27/10, deux lignes changées
-- -----------------------------------------------------------------------------
-- GARDE (02/11) : stats_dashboard est définie aujourd'hui par commandes_produit_id.sql.
-- Ce fichier ne la réécrit que si elle manque, n'a pas de marque, porte la
-- sienne ou celle d'un fichier plus ancien. Marquée par un fichier plus
-- récent → gardée telle quelle, avec un avis (rien n'échoue).
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.stats_dashboard(uuid, timestamptz, timestamptz)'), 'pg_proc');
begin
  if v_marque in ('fichier: commandes_produit_id.sql') then
    raise notice 'statut_pending.sql : stats_dashboard gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
CREATE OR REPLACE FUNCTION public.stats_dashboard(p_tenant uuid, p_debut timestamp with time zone, p_fin timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  resultat jsonb;
begin
  return (
    with st as (
      select s.nom, s.code,
             coalesce(s.declenche_assignation, false) as confirme,
             coalesce(s.necessite_rappel, false)      as rappel
      from public.statuts s
      where s.tenant_id = p_tenant
    ),
    cmd as (
      select c.*,
             coalesce(c.created_at, c.date_commande::timestamptz) as moment
      from public.commandes c
      where c.tenant_id = p_tenant
    ),
    cmd_periode as (
      select * from cmd where moment >= p_debut and moment <= p_fin
    ),
    classe as (
      select c.*,
        case
          -- 27/10 : « Pending » est un vrai statut ; NULL reste lu tant que le
          -- rattrapage (statut_pending_2_rattrapage.sql) n'est pas passé.
          when c.statut_confirmation is null or c.statut_confirmation = 'Pending' then 'en_attente'
          when exists (select 1 from st
                       where (st.nom = c.statut_confirmation or st.code = c.statut_confirmation)
                         and st.confirme) then 'confirmee'
          when exists (select 1 from st
                       where (st.nom = c.statut_confirmation or st.code = c.statut_confirmation)
                         and st.rappel) then 'rappel'
          when c.statut_confirmation ~* '(annul|cancel)'            then 'annulee'
          when c.statut_confirmation ~* '(injoign|unreach|unrech)'  then 'injoignable'
          else 'autre'
        end as classe
      from cmd_periode c
    ),
    liv as (
      select v.*,
        case
          when lower(coalesce(v.statut, 'en_attente')) in ('livre', 'livree', 'livrée') then 'livre'
          when lower(coalesce(v.statut, 'en_attente')) ~ 'expedi'                       then 'en_attente'
          else lower(coalesce(v.statut, 'en_attente'))
        end as statut_propre
      from public.livraisons v
      where v.tenant_id = p_tenant
        and v.created_at >= p_debut and v.created_at <= p_fin
    ),
    -- un appel par commande : sinon un agent qui rappelle 3 fois compte 3 fois
    appel_cmd as (
      select distinct on (a.commande_id) a.commande_id, a.agent_id
      from public.appels a
      where a.tenant_id = p_tenant
        and a.created_at >= p_debut and a.created_at <= p_fin
      order by a.commande_id, a.created_at
    ),
    nb_appels as (
      select a.agent_id, count(*)::int as appels
      from public.appels a
      where a.tenant_id = p_tenant
        and a.created_at >= p_debut and a.created_at <= p_fin
      group by a.agent_id
    ),
    par_agent as (
      select
        ac.agent_id,
        count(*) filter (where cl.classe = 'confirmee')   ::int as confirmees,
        count(*) filter (where cl.classe = 'injoignable') ::int as injoignables,
        count(*) filter (where cl.classe = 'annulee')     ::int as annulees,
        count(*) filter (where cl.classe = 'rappel')      ::int as reprogrammees,
        count(*) filter (where cl.id in (select commande_id from liv where statut_propre = 'livre'))::int as livrees
      from appel_cmd ac
      join classe cl on cl.id = ac.commande_id
      group by ac.agent_id
    )
    select jsonb_build_object(

      'kpis', jsonb_build_object(
        'commandesTotal', (select count(*) from cmd_periode),
        'commandesJour',  (select count(*) from cmd
                           where moment >= date_trunc('day', now())),
        'tauxConfirmation', coalesce(round(
            100.0 * (select count(*) from classe where classe = 'confirmee')
                  / nullif((select count(*) from classe), 0), 1), 0),
        'tauxLivraison', coalesce(round(
            100.0 * (select count(*) from liv where statut_propre = 'livre')
                  / nullif((select count(*) from liv), 0), 1), 0)
      ),

      'caEncaisseListe', coalesce((
        select jsonb_agg(x order by x->>'total' desc)
        from (
          select jsonb_build_object(
                   'devise', coalesce(pa.devise, 'N/A'),
                   'total',  sum(p.montant)
                 ) as x
          from public.paiements p
          left join public.commandes c on c.id = p.commande_id
          left join public.pays pa     on pa.id = c.pays_id
          where p.tenant_id = p_tenant
            and p.statut in ('en_attente', 'encaisse', 'remis')
            and p.created_at >= p_debut and p.created_at <= p_fin
          group by coalesce(pa.devise, 'N/A')
        ) s
      ), '[]'::jsonb),

      'confirmationParHeure', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'heure', h,
                 'confirmees', coalesce(c.nb_conf, 0),
                 'annulees',   coalesce(c.nb_ann, 0)) order by h)
        from generate_series(0, 23) as h
        left join (
          select extract(hour from coalesce(updated_at, moment))::int as heure,
                 count(*) filter (where classe = 'confirmee') as nb_conf,
                 count(*) filter (where classe = 'annulee')   as nb_ann
          from classe group by 1
        ) c on c.heure = h
      ), '[]'::jsonb),

      'statutsLivraison', coalesce((
        select jsonb_agg(jsonb_build_object('nom', nom, 'valeur', n, 'couleur', couleur))
        from (
          select
            case statut_propre
              when 'en_attente'  then 'En attente'
              when 'livre'       then 'Livrée'
              when 'injoignable' then 'Injoignable'
              when 'retour'      then 'Retour'
              else statut_propre
            end as nom,
            case statut_propre
              when 'en_attente'  then '#FFB162'
              when 'livre'       then '#1B2632'
              when 'injoignable' then '#C9C1B1'
              when 'retour'      then '#A35139'
              else '#C9C1B1'
            end as couleur,
            count(*)::int as n
          from liv group by statut_propre
        ) s
      ), '[]'::jsonb),

      -- la répartition des commandes par statut d'appel, avec le NOM réel du
      -- statut tel qu'il est enregistré dans Paramètres
      'overviewAppels', coalesce((
        select jsonb_agg(jsonb_build_object('label', label, 'valeur', n, 'pct', pct) order by n desc)
        from (
          select coalesce(statut_confirmation, 'Pending') as label,
                 count(*)::int as n,
                 coalesce(round(100.0 * count(*) / nullif((select count(*) from classe), 0))::int, 0) as pct
          from classe group by 1
        ) s
      ), '[]'::jsonb),

      'topProduits', coalesce((
        select jsonb_agg(jsonb_build_object('rang', rang, 'nom', nom, 'qte', qte) order by rang)
        from (
          select row_number() over (order by sum(coalesce(quantite, 1)) desc)::int as rang,
                 produit as nom,
                 sum(coalesce(quantite, 1))::int as qte
          from classe where produit is not null and btrim(produit) <> ''
          group by produit order by qte desc limit 5
        ) s
      ), '[]'::jsonb),

      'topAgents', coalesce((
        select jsonb_agg(jsonb_build_object('nom', nom, 'livrees', livrees) order by livrees desc)
        from (
          select coalesce(ag.nom, 'Agent non assigné') as nom, pa.livrees
          from par_agent pa
          left join public.agents ag on ag.id = pa.agent_id
          where pa.livrees > 0
          order by pa.livrees desc limit 5
        ) s
      ), '[]'::jsonb),

      'analyticsAgents', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nom', nom, 'appels', appels, 'confirmees', confirmees,
                 'injoignables', injoignables, 'annulees', annulees,
                 'reprogrammees', reprogrammees, 'traitees', traitees,
                 'taux', taux) order by confirmees desc, appels desc)
        from (
          select coalesce(ag.nom, 'Agent non assigné') as nom,
                 coalesce(na.appels, 0) as appels,
                 pa.confirmees, pa.injoignables, pa.annulees, pa.reprogrammees,
                 (pa.confirmees + pa.injoignables + pa.annulees + pa.reprogrammees) as traitees,
                 coalesce(round(100.0 * pa.confirmees / nullif(
                   pa.confirmees + pa.injoignables + pa.annulees + pa.reprogrammees, 0))::int, 0) as taux
          from par_agent pa
          left join public.agents ag on ag.id = pa.agent_id
          left join nb_appels na on na.agent_id is not distinct from pa.agent_id
        ) s
      ), '[]'::jsonb),

      'totauxAgents', (
        select jsonb_build_object(
          'appels',        coalesce((select sum(appels) from nb_appels), 0),
          'confirmees',    coalesce(sum(confirmees), 0),
          'injoignables',  coalesce(sum(injoignables), 0),
          'annulees',      coalesce(sum(annulees), 0),
          'reprogrammees', coalesce(sum(reprogrammees), 0))
        from par_agent
      )
    )
  );
end;
$function$
$def$;
  comment on function public.stats_dashboard(uuid, timestamptz, timestamptz) is 'fichier: statut_pending.sql';
end $garde$;


-- -----------------------------------------------------------------------------
-- 6. Vérification — lève une erreur si quelque chose manque
-- -----------------------------------------------------------------------------
do $$
declare v_sans int;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.commandes'::regclass
                  and tgname = 'trg_aa_statut_pending' and tgenabled <> 'D') then
    raise exception 'trg_aa_statut_pending absent ou désactivé.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.statuts'::regclass
                  and tgname = 'trg_statut_pending_fige' and tgenabled <> 'D') then
    raise exception 'trg_statut_pending_fige absent ou désactivé.';
  end if;
  select count(*) into v_sans from public.tenants t
   where not exists (select 1 from public.statuts s where s.tenant_id = t.id and s.code = 'pending');
  if v_sans > 0 then
    raise exception '% entreprise(s) sans ligne « Pending ».', v_sans;
  end if;
  if position(quote_literal('Pending') in pg_get_functiondef('public.choisir_agent(uuid,uuid)'::regprocedure)) = 0
     or position(quote_literal('Pending') in pg_get_functiondef('public.stats_dashboard(uuid,timestamptz,timestamptz)'::regprocedure)) = 0 then
    raise exception 'choisir_agent ou stats_dashboard ne lit pas encore « Pending ».';
  end if;
  raise notice 'statut_pending.sql : en place. Aucune commande existante modifiée (fichier 2 pour le rattrapage).';
end $$;

-- Ce qui est en place : une ligne « Pending » par entreprise.
select t.nom_entreprise, s.nom, s.code, s.ferme_le_lead, s.declenche_assignation
  from public.statuts s join public.tenants t on t.id = s.tenant_id
 where s.code = 'pending'
 order by 1;
