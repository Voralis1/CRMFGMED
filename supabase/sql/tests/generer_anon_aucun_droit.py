#!/usr/bin/env python3
# Génère anon_aucun_droit.sql et anon_aucun_droit_retour.sql (02/11/2026).
#
# Les deux fichiers portent la MÊME photo des droits (littéraux), lue sur une
# base par LECTURE (ci-dessous) :
#   · le fichier aller refuse de tourner si la base n'est plus exactement
#     cette photo (sinon le retour ne la remettrait pas) ;
#   · le retour remet chaque objet EXACTEMENT dans cet état, puis le vérifie.
# Le SQL autour des littéraux est le même quelle que soit la base : les tests
# génèrent les fichiers depuis la base de test, la production depuis la
# production, et vérifient que seuls les littéraux diffèrent.
#
#   python3 generer_anon_aucun_droit.py lecture            → la requête de lecture
#   python3 generer_anon_aucun_droit.py ecrire <photo.json> <dossier> <date>
#       photo.json = [{"quoi":…, "objet":…, "acl":…}, …] (résultat de la lecture)
import json, sys, os

# Une liste de droits, triée (collation "C") : l'ordre des entrées n'a pas de
# sens, et un droit redonné s'ajoute en fin de liste.
TRI = "coalesce(array_to_string(array(select x::text from unnest({a}) x order by x::text collate \"C\"), ','), '')"
NOM_FN = "p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')'"

LECTURE = f"""
  select 'rel'::text as quoi, c.relname::text as objet, {TRI.format(a='c.relacl')} as acl
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
  union all
  select 'col', c.relname || '.' || a.attname, {TRI.format(a='a.attacl')}
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  union all
  select 'fn', {NOM_FN}, {TRI.format(a='p.proacl')}
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
  union all
  select 'def', pg_get_userbyid(d.defaclrole) || '|'
                || case when d.defaclnamespace = 0 then '(global)' else d.defaclnamespace::regnamespace::text end
                || '|' || d.defaclobjtype::text,
         {TRI.format(a='d.defaclacl')}
    from pg_default_acl d
   where d.defaclnamespace in (0, 'public'::regnamespace)
  union all
  select 'opt', c.relname, coalesce(array_to_string(c.reloptions, ','), '')
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname = 'v_pays_livrables'
"""

COMMUN = """
-- ---------------------------------------------------------------------------
-- Outils (temporaires : pg_temp, disparaissent avec la session)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.etat_acl()
returns table (quoi text, objet text, acl text)
language sql stable as $f$
""" + LECTURE + """
$f$;

-- Les droits EFFECTIFS de chaque rôle (sauf anon et les rôles pg_*) sur chaque
-- objet de public : table, colonne, séquence, fonction, schéma.
create or replace function pg_temp.droits_effectifs()
returns table (role text, quoi text, objet text, priv text, ok boolean)
language sql stable as $f$
  with roles as (select rolname::text as rolname from pg_roles where rolname !~ '^pg_' and rolname <> 'anon'),
  rel as (select c.oid, c.relname::text as relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')),
  seq as (select c.oid, c.relname::text as relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'),
  tp as (select unnest(case when current_setting('server_version_num')::int >= 170000
                            then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                            else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] end) as p)
  select r.rolname, 'rel', rel.relname, tp.p, has_table_privilege(r.rolname, rel.oid, tp.p) from roles r, rel, tp
  union all
  select r.rolname, 'seq', s.relname, sp.p, has_sequence_privilege(r.rolname, s.oid, sp.p)
    from roles r, seq s, (values ('SELECT'), ('UPDATE'), ('USAGE')) sp(p)
  union all
  select r.rolname, 'col', rel.relname || '.' || a.attname, cp.p, has_column_privilege(r.rolname, rel.oid, a.attnum, cp.p)
    from roles r, rel
    join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped,
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) cp(p)
  union all
  select r.rolname, 'fn', """ + NOM_FN + """, 'EXECUTE', has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    from roles r, pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select r.rolname, 'schema', 'public', sp.p, has_schema_privilege(r.rolname, 'public', sp.p)
    from roles r, (values ('USAGE'), ('CREATE')) sp(p)
$f$;

-- Ce qu'anon peut encore faire dans public (doit être vide après le fichier).
create or replace function pg_temp.droits_anon()
returns table (quoi text, objet text, priv text)
language sql stable as $f$
  select 'rel', c.relname::text, p
    from pg_class c,
         unnest(case when current_setting('server_version_num')::int >= 170000
                     then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                     else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] end) p
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and has_table_privilege('anon', c.oid, p)
  union all
  select 'col', c.relname::text, 'une colonne'
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
  union all
  select 'seq', c.relname::text, p
    from pg_class c, unnest(array['SELECT', 'UPDATE', 'USAGE']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and has_sequence_privilege('anon', c.oid, p)
  union all
  select 'fn', """ + NOM_FN + """, 'EXECUTE'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
$f$;
"""

def litteraux(rows, date):
    def q(s): return "'" + str(s).replace("'", "''") + "'"
    lignes = ",\n".join(f"  ({q(r['quoi'])}, {q(r['objet'])}, {q(r['acl'] if r['acl'] is not None else '')})"
                        for r in sorted(rows, key=lambda r: (r['quoi'], r['objet'])))
    n = {k: sum(1 for r in rows if r['quoi'] == k) for k in ('rel', 'col', 'fn', 'def', 'opt')}
    return (f"-- ===== LITTÉRAUX : les droits lus le {date} ({n['rel']} relations, {n['col']} colonnes,\n"
            f"--       {n['fn']} fonctions, {n['def']} droits par défaut, {n['opt']} option de vue) =====\n"
            "drop table if exists pg_temp._acl_lu;\n"
            "create temp table _acl_lu (quoi text, objet text, acl text);\n"
            "insert into _acl_lu (quoi, objet, acl) values\n" + lignes + ";\n"
            "-- ===== FIN DES LITTÉRAUX =====\n")

ALLER_TETE = """-- =============================================================================
-- ANON NE TIENT PLUS RIEN DANS public — {date}
-- =============================================================================
--
-- NE CHANGE AUCUNE DONNÉE. Change des DROITS — le fichier le plus dangereux du
-- projet : un droit perdu par authenticated ou service_role sur une seule
-- fonction et plus aucune politique ne se résout (l'application s'arrête).
-- D'où : une photo, une vérification TOTALE, une répétition des vrais chemins.
-- Tout est dans UN bloc : une seule erreur et RIEN n'est fait.
--
-- POURQUOI. anon (la clé publique, un compte que personne n'utilise pour se
-- connecter) tenait (lu le 02/11) : tous les droits sur 29 tables — TRUNCATE
-- compris, que la RLS ne couvre pas —, sur 6 vues, select/update sur 4
-- séquences (setval de commandes_tracking_seq = des n° de suivi réémis), et
-- l'exécution de 48 fonctions. Rien de tout ça n'était utilisable AUJOURD'HUI,
-- mais seulement grâce à autre chose (la RLS, le WHERE d'une vue, l'API REST
-- qui n'expose ni TRUNCATE ni setval) : de la chance, pas une défense. Et la
-- SOURCE : les droits PAR DÉFAUT de postgres (et supabase_admin) dans public
-- donnaient tout à anon sur chaque NOUVEL objet — chaque fichier SQL du projet
-- lui en a redonné. Personne n'a besoin d'anon (lu le 02/11 : la page de
-- connexion n'interroge pas la base, chaque Edge Function utilise la clé
-- service ; les connexions passent par Supabase Auth, hors public).
--
-- CE QUE FAIT LE FICHIER (dans cet ordre, un seul bloc) :
--   §0 la base doit être EXACTEMENT la photo ci-dessous (droits de chaque
--      relation, colonne, fonction, droits par défaut, option de la vue) —
--      sinon le retour arrière ne la remettrait pas : refus, rien fait.
--      Déjà passé (anon ne tient plus rien) → « déjà en place », rien fait.
--   §1 photo des droits EFFECTIFS de chaque rôle sauf anon (authenticated,
--      service_role, authenticator, supabase_auth_admin…) sur chaque objet.
--   §2 LES DROITS PAR DÉFAUT d'abord : postgres ne donne plus rien à anon sur
--      les nouvelles tables, séquences, fonctions de public, et une nouvelle
--      fonction n'est plus exécutable par PUBLIC (défaut global de postgres :
--      authenticated et service_role la reçoivent toujours par le défaut de
--      public). Même chose pour supabase_admin SI postgres en a le droit —
--      sinon un avis le dit (ses objets dans public : aucun, lu le 02/11).
--   §3 anon perd tout sur chaque table, vue, séquence de public.
--   §4 fonctions : PUBLIC et anon perdent l'exécution ; chaque rôle qui
--      l'avait PAR PUBLIC la reçoit explicitement (sinon l'application tombe).
--   §5 v_pays_livrables : security_barrier.
--   §6 VÉRIFICATION TOTALE : les droits effectifs de chaque rôle sauf anon,
--      objet par objet, colonne par colonne = la photo du §1 ; anon ne tient
--      plus rien ; les droits par défaut ne donnent plus rien à anon/PUBLIC.
--      Une seule différence → rien n'est fait.
--   §7 RÉPÉTITION des vrais chemins (annulée) : un vendeur lit ses commandes
--      et en crée une ; un agent lit ses leads, son appel est enregistré
--      (confirmer-appel, clé service) ; un livreur lit ses livraisons, la
--      sienne est marquée livrée avec son paiement (confirmer-livraison, clé
--      service) ; un manager passe un lot (changer_statut_lot) et lit
--      l'historique ; l'API (import-commande, clé service) crée une commande ;
--      anon est refusé partout (lecture, fonction, setval, TRUNCATE). Un seul
--      chemin qui n'aboutit pas → rien n'est fait.
--
-- On GARDE l'accès d'anon au schéma (USAGE) : il n'y trouve plus rien.
--
-- RETOUR ARRIÈRE : anon_aucun_droit_retour.sql (copie sur le Bureau) — remet
-- chaque objet EXACTEMENT comme dans la photo et le vérifie. Une collée.
--
-- À LANCER à un moment calme, personne au travail. Généré par
-- supabase/sql/tests/generer_anon_aucun_droit.py — ne pas éditer les littéraux
-- à la main : régénérer depuis la base.
-- =============================================================================

"""

ALLER_CORPS = """
do $$
declare
  v_diff   text;
  v_sa     boolean := false;
  v_n      integer;
  n_rel    integer := 0;
  n_fn     integer := 0;
  n_redon  integer := 0;
  r        record;
  -- répétition
  v_t uuid; v_vend uuid; v_agent_user uuid; v_agent uuid; v_liv_user uuid; v_liv uuid; v_livraison uuid;
  v_liv_cmd uuid; v_resp uuid; v_lead1 uuid; v_lead2 uuid; v_pays uuid; v_txt text; v_attendu integer;
  v_msg text; v_refus boolean; v_etape text := 'préparation';
begin
  -- §0 ------------------------------------------------------------------------
  select string_agg(d, ', ') into v_diff from (
    select coalesce(l.quoi, e.quoi) || ' ' || coalesce(l.objet, e.objet) as d
      from _acl_lu l full join pg_temp.etat_acl() e on e.quoi = l.quoi and e.objet = l.objet
     where l.acl is distinct from e.acl
     order by 1) x;
  if v_diff is not null then
    if not exists (select 1 from pg_temp.droits_anon())
       and not exists (select 1 from pg_default_acl d
                        where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
                          and d.defaclacl::text like '%anon=%') then
      raise notice 'anon_aucun_droit.sql : déjà en place (anon ne tient rien dans public). Rien n''a été fait.';
      return;
    end if;
    raise exception 'anon_aucun_droit.sql : la base n''est plus celle de la photo (%). Le retour arrière ne la remettrait pas exactement : RIEN n''a été fait. Régénérez les deux fichiers depuis la base.', left(v_diff, 2000);
  end if;

  -- §1 ------------------------------------------------------------------------
  drop table if exists pg_temp._droits_avant;
  create temp table _droits_avant as select * from pg_temp.droits_effectifs();

  -- §2 Les droits par défaut, d'abord -----------------------------------------
  execute 'alter default privileges for role postgres in schema public revoke all on tables from anon';
  execute 'alter default privileges for role postgres in schema public revoke all on sequences from anon';
  execute 'alter default privileges for role postgres in schema public revoke all on functions from anon';
  execute 'alter default privileges for role postgres revoke execute on functions from public';
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
    execute 'alter default privileges for role supabase_admin revoke execute on functions from public';
    v_sa := true;
  exception when insufficient_privilege or undefined_object then
    v_sa := false;
  end;

  -- §3 Tables, vues, séquences ------------------------------------------------
  for r in select c.oid, c.relkind from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f') loop
    execute format('revoke all on %s %s from anon',
                   case when r.relkind = 'S' then 'sequence' else 'table' end, r.oid::regclass);
    n_rel := n_rel + 1;
  end loop;
  for r in select c.oid, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
            where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
              and exists (select 1 from aclexplode(a.attacl) x where x.grantee = 'anon'::regrole) loop
    execute format('revoke all (%I) on table %s from anon', r.attname, r.oid::regclass);
  end loop;

  -- §4 Fonctions --------------------------------------------------------------
  for r in select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (has_function_privilege('anon', p.oid, 'EXECUTE')
                   or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0)) loop
    execute format('revoke all on function %s from public, anon', r.oid::regprocedure);
    n_fn := n_fn + 1;
  end loop;
  -- chaque rôle qui l'exécutait (par PUBLIC) la reçoit explicitement
  for r in select a.role, p.oid
             from _droits_avant a
             join pg_proc p on p.pronamespace = 'public'::regnamespace
                           and p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')' = a.objet
            where a.quoi = 'fn' and a.ok
              and not has_function_privilege(a.role, p.oid, 'EXECUTE') loop
    execute format('grant execute on function %s to %I', r.oid::regprocedure, r.role);
    n_redon := n_redon + 1;
  end loop;

  -- §5 ------------------------------------------------------------------------
  execute 'alter view public.v_pays_livrables set (security_barrier = true)';

  -- §6 VÉRIFICATION TOTALE ------------------------------------------------------
  select string_agg(d, ' ; ') into v_diff from (
    select coalesce(a.role, b.role) || ' ' || coalesce(a.quoi, b.quoi) || ' ' || coalesce(a.objet, b.objet) || ' '
           || coalesce(a.priv, b.priv) || ' : avant ' || coalesce(a.ok::text, '—') || ', après ' || coalesce(b.ok::text, '—') as d
      from _droits_avant a full join pg_temp.droits_effectifs() b
        on b.role = a.role and b.quoi = a.quoi and b.objet = a.objet and b.priv = a.priv
     where a.ok is distinct from b.ok
     order by 1 limit 30) x;
  if v_diff is not null then
    raise exception 'anon_aucun_droit.sql — VÉRIFICATION ÉCHOUÉE, un autre rôle qu''anon a changé de droits : %. RIEN n''a été fait.', v_diff;
  end if;
  select string_agg(quoi || ' ' || objet || ' ' || priv, ', ') into v_diff from (select * from pg_temp.droits_anon() limit 30) x;
  if v_diff is not null then
    raise exception 'anon_aucun_droit.sql — VÉRIFICATION ÉCHOUÉE, anon tient encore : %. RIEN n''a été fait.', v_diff;
  end if;
  if exists (select 1 from pg_default_acl d
              where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
                and exists (select 1 from aclexplode(d.defaclacl) x where x.grantee = 'anon'::regrole))
     or not exists (select 1 from pg_default_acl d
                     where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
                       and not exists (select 1 from aclexplode(d.defaclacl) x where x.grantee = 0)) then
    raise exception 'anon_aucun_droit.sql — VÉRIFICATION ÉCHOUÉE : les droits par défaut donnent encore à anon ou à PUBLIC. RIEN n''a été fait.';
  end if;

  -- §7 RÉPÉTITION DES VRAIS CHEMINS (annulée) ------------------------------------
  select ur.tenant_id into v_t
    from public.user_roles ur
   where ur.role = 'seller'
     and exists (select 1 from public.commandes c where c.vendeur_id = ur.user_id and c.tenant_id = ur.tenant_id)
     and exists (select 1 from public.agents a join public.user_roles x on x.user_id = a.user_id and x.role = 'agent'
                  where a.tenant_id = ur.tenant_id and a.actif)
     and exists (select 1 from public.livreurs l join public.livraisons v on v.livreur_id = l.id
                  where l.tenant_id = ur.tenant_id and l.user_id is not null and v.statut in ('a_preparer', 'expedie'))
     and exists (select 1 from public.user_roles m where m.tenant_id = ur.tenant_id and m.role in ('manager', 'admin'))
     and (select count(*) from public.commandes c
           where c.tenant_id = ur.tenant_id and c.statut_confirmation = 'Pending'
             and not exists (select 1 from public.livraisons v where v.commande_id = c.id)) >= 2
   order by (ur.tenant_id = '17144700-2b95-43fa-9849-9e7a8f35104e') desc, ur.tenant_id
   limit 1;
  if v_t is null then
    raise exception 'anon_aucun_droit.sql — RÉPÉTITION IMPOSSIBLE : aucune entreprise avec un vendeur qui a des commandes, un agent actif, un livreur avec une livraison à préparer, un manager et deux leads « Pending » sans livraison. RIEN n''a été fait.';
  end if;
  select ur.user_id into v_vend from public.user_roles ur
   where ur.tenant_id = v_t and ur.role = 'seller'
     and exists (select 1 from public.commandes c where c.vendeur_id = ur.user_id and c.tenant_id = v_t)
   order by ur.user_id limit 1;
  select a.user_id, a.id into v_agent_user, v_agent from public.agents a
    join public.user_roles x on x.user_id = a.user_id and x.role = 'agent'
   where a.tenant_id = v_t and a.actif order by a.id limit 1;
  select l.user_id, l.id, v.id, v.commande_id into v_liv_user, v_liv, v_livraison, v_liv_cmd
    from public.livreurs l join public.livraisons v on v.livreur_id = l.id
   where l.tenant_id = v_t and l.user_id is not null and v.statut in ('a_preparer', 'expedie')
   order by v.created_at desc limit 1;
  select user_id into v_resp from public.user_roles
   where tenant_id = v_t and role in ('manager', 'admin') order by role desc, user_id limit 1;
  select c.id into v_lead1 from public.commandes c
   where c.tenant_id = v_t and c.statut_confirmation = 'Pending'
     and not exists (select 1 from public.livraisons v where v.commande_id = c.id)
   order by c.created_at desc limit 1;
  select c.id into v_lead2 from public.commandes c
   where c.tenant_id = v_t and c.statut_confirmation = 'Pending' and c.id <> v_lead1
     and not exists (select 1 from public.livraisons v where v.commande_id = c.id)
   order by c.created_at desc limit 1;
  select p.id into v_pays from public.pays p where p.tenant_id = v_t order by p.nom limit 1;

  begin
    v_etape := 'vendeur';
    -- le vendeur : ses commandes, l'historique, ses pays, le tableau de bord ; il crée une commande
    select count(*) into v_attendu from public.commandes where tenant_id = v_t and vendeur_id = v_vend;
    perform set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.commandes;
    if v_n <> v_attendu then raise exception 'vendeur : % commande(s) lue(s) au lieu de %', v_n, v_attendu; end if;
    perform count(*) from public.v_historique_statuts;
    perform count(*) from public.v_pays_livrables;
    perform public.stats_dashboard(v_t, '-infinity', 'infinity');
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, vendeur_id)
    values (v_t, 'REPETITION-ANON-V-' || gen_random_uuid(), 'Répétition', '+000', 'Répétition', 1, 0, v_pays, 'Répétition', v_vend)
    returning tracking_number into v_txt;
    execute 'reset role';
    if v_txt is null then raise exception 'vendeur : sa commande n''a pas reçu de n° de suivi'; end if;

    v_etape := 'agent (confirmer-appel)';
    -- l'agent : ses leads ; confirmer-appel (clé service) enregistre son appel
    select count(*) into v_attendu from public.commandes
     where tenant_id = v_t and (agent_id = v_agent or agent_id is null);
    perform set_config('request.jwt.claims', json_build_object('sub', v_agent_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.commandes;
    execute 'reset role';
    if v_n <> v_attendu then raise exception 'agent : % lead(s) lu(s) au lieu de %', v_n, v_attendu; end if;
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    execute 'set local role service_role';
    perform public.enregistrer_appel(v_lead1, v_t, v_agent_user, v_agent, 'Unreached', 'Pending',
                                     'Répétition anon_aucun_droit', 30, null, '{}'::jsonb);
    execute 'reset role';
    if (select statut_confirmation from public.commandes where id = v_lead1) <> 'Unreached'
       or not exists (select 1 from public.historique_statuts where commande_id = v_lead1 and via = 'confirmer-appel'
                        and note = 'Répétition anon_aucun_droit') then
      raise exception 'agent : l''appel n''a pas été enregistré (statut ou historique)';
    end if;

    v_etape := 'livreur (confirmer-livraison)';
    -- le livreur : ses livraisons ; confirmer-livraison (clé service) : livrée + paiement
    select count(*) into v_attendu from public.livraisons where tenant_id = v_t and livreur_id = v_liv;
    perform set_config('request.jwt.claims', json_build_object('sub', v_liv_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.livraisons;
    execute 'reset role';
    if v_n <> v_attendu then raise exception 'livreur : % livraison(s) lue(s) au lieu de %', v_n, v_attendu; end if;
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    execute 'set local role service_role';
    update public.livraisons set statut = 'livre', date_livraison = now() where id = v_livraison;
    update public.commandes set statut_livraison = 'livre', updated_at = now() where id = v_liv_cmd;
    insert into public.paiements (commande_id, livreur_id, tenant_id, montant, methode, statut)
    values (v_liv_cmd, v_liv, v_t, 0, 'cod', 'en_attente');
    execute 'reset role';
    if (select statut from public.livraisons where id = v_livraison) <> 'livre' then
      raise exception 'livreur : la livraison n''est pas passée à « livré »';
    end if;

    v_etape := 'manager (lot)';
    -- le manager : un lot, l'historique, la mesure du délai
    perform set_config('request.jwt.claims', json_build_object('sub', v_resp, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select l.resultat into v_txt from public.changer_statut_lot(v_t, array[v_lead2], 'Unreached', null, null) l;
    select count(*) into v_n from public.v_historique_statuts;
    if to_regprocedure('public.delai_prise_en_charge(uuid, timestamptz, timestamptz)') is not null then
      perform public.delai_prise_en_charge(v_t, '-infinity', 'infinity');
    end if;
    execute 'reset role';
    if v_txt is distinct from 'applique' then raise exception 'manager : le lot a répondu « % »', v_txt; end if;
    if v_n = 0 then raise exception 'manager : historique vide'; end if;

    v_etape := 'API (import-commande)';
    -- l'API (import-commande, clé service) crée une commande
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    execute 'set local role service_role';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix, pays_id, ville_zone, source)
    values (v_t, 'REPETITION-ANON-A-' || gen_random_uuid(), 'Répétition', '+000', 'Répétition', 1, 0, v_pays, 'Répétition', 'api')
    returning tracking_number into v_txt;
    execute 'reset role';
    if v_txt is null then raise exception 'API : la commande n''a pas reçu de n° de suivi'; end if;

    v_etape := 'anon refusé';
    -- anon : refusé partout
    perform set_config('request.jwt.claims', '{}', true);
    execute 'set local role anon';
    v_refus := false; begin perform 1 from public.commandes limit 1; exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon lit encore commandes'; end if;
    v_refus := false; begin perform public.is_super_admin(); exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon exécute encore is_super_admin'; end if;
    v_refus := false; begin perform 1 from public.v_pays_livrables limit 1; exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon lit encore v_pays_livrables'; end if;
    v_refus := false; begin perform setval('public.commandes_tracking_seq', 1); exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon peut encore remettre la séquence des n° de suivi (setval)'; end if;
    v_refus := false; begin execute 'truncate public.motifs_retour'; exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'anon peut encore vider une table (TRUNCATE)'; end if;
    execute 'reset role';

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'anon_aucun_droit.sql — RÉPÉTITION ÉCHOUÉE (étape : %) : %. RIEN n''a été fait.', v_etape, v_msg;
    end if;
  end;

  raise notice 'anon_aucun_droit.sql : fait. anon ne tient plus rien (% relations, % fonctions retirées à PUBLIC/anon, % droits redonnés explicitement). Droits par défaut de postgres corrigés%. Tous les autres rôles : droits identiques, vérifiés objet par objet. Répétition (vendeur, agent, livreur, manager, API, anon refusé) réussie et annulée.',
    n_rel, n_fn, n_redon,
    case when v_sa then ', et ceux de supabase_admin' else ' (PAS ceux de supabase_admin : postgres n''en a pas le droit — ses nouveaux objets dans public donneraient encore à anon ; aucun le 02/11)' end;
end $$;

drop table if exists pg_temp._acl_lu;
drop table if exists pg_temp._droits_avant;
"""

RETOUR_TETE = """-- =============================================================================
-- RETOUR ARRIÈRE de anon_aucun_droit.sql — {date}
-- =============================================================================
-- Remet CHAQUE objet de public (relation, colonne, fonction), les droits par
-- défaut et l'option de v_pays_livrables EXACTEMENT comme dans la photo
-- ci-dessous (lue le {date}, la même que celle du fichier aller), puis le
-- VÉRIFIE objet par objet ; une seule différence → le retour s'annule en
-- entier et le dit. « Exactement » = les mêmes entrées dans chaque liste de
-- droits (l'ordre des entrées n'a pas de sens : un droit redonné s'ajoute en
-- fin de liste). Une collée, rejouable. Aucune donnée touchée.
-- ⚠ Remet anon dans l'état d'avant : tous ses droits reviennent.
-- =============================================================================

"""

RETOUR_CORPS = """
-- Rend la liste de droits d'un objet égale à la photo : donne ce qui manque,
-- retire ce qui est en trop.
create or replace function pg_temp.converger(p_quoi text, p_objet text, p_acl text)
returns integer
language plpgsql as $f$
declare
  v_oid    oid;
  v_kind   "char";
  v_col    name;
  v_sur    text;
  v_actuel aclitem[];
  v_voulu  aclitem[] := case when p_acl = '' then '{}'::aclitem[] else ('{' || p_acl || '}')::aclitem[] end;
  v_qui    text;
  v_n      integer := 0;
  r        record;
begin
  if p_quoi in ('rel', 'col') then
    select c.oid, c.relkind, c.relacl into v_oid, v_kind, v_actuel
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = split_part(p_objet, '.', 1);
    if v_oid is null then raise exception 'Retour : % % n''existe plus.', p_quoi, p_objet; end if;
    if p_quoi = 'col' then
      v_col := split_part(p_objet, '.', 2);
      select a.attacl into v_actuel from pg_attribute a where a.attrelid = v_oid and a.attname = v_col;
    end if;
    v_sur := case when v_kind = 'S' then 'sequence ' else 'table ' end || v_oid::regclass::text;
  else
    select p.oid, p.proacl into v_oid, v_actuel from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')' = p_objet;
    if v_oid is null then raise exception 'Retour : la fonction % n''existe plus.', p_objet; end if;
    v_sur := 'function ' || v_oid::regprocedure::text;
  end if;
  for r in select x.grantee, x.privilege_type, x.is_grantable from aclexplode(v_voulu) x
           except select y.grantee, y.privilege_type, y.is_grantable from aclexplode(coalesce(v_actuel, '{}'::aclitem[])) y loop
    v_qui := case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end;
    execute format('grant %s%s on %s to %s%s', r.privilege_type,
                   case when v_col is not null then ' (' || quote_ident(v_col) || ')' else '' end,
                   v_sur, v_qui, case when r.is_grantable then ' with grant option' else '' end);
    v_n := v_n + 1;
  end loop;
  for r in select y.grantee, y.privilege_type from aclexplode(coalesce(v_actuel, '{}'::aclitem[])) y
           except select x.grantee, x.privilege_type from aclexplode(v_voulu) x loop
    v_qui := case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end;
    execute format('revoke %s%s on %s from %s', r.privilege_type,
                   case when v_col is not null then ' (' || quote_ident(v_col) || ')' else '' end, v_sur, v_qui);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$f$;

do $$
declare
  v_diff text;
  v_n    integer := 0;
  v_sa   boolean := true;
  r      record;
begin
  -- les droits par défaut d'avant
  execute 'alter default privileges for role postgres in schema public grant all on tables to anon';
  execute 'alter default privileges for role postgres in schema public grant select, update, usage on sequences to anon';
  execute 'alter default privileges for role postgres in schema public grant execute on functions to anon';
  execute 'alter default privileges for role postgres grant execute on functions to public';
  begin
    execute 'alter default privileges for role supabase_admin in schema public grant all on tables to anon';
    execute 'alter default privileges for role supabase_admin in schema public grant select, update, usage on sequences to anon';
    execute 'alter default privileges for role supabase_admin in schema public grant execute on functions to anon';
    execute 'alter default privileges for role supabase_admin grant execute on functions to public';
  exception when insufficient_privilege or undefined_object then
    v_sa := false;
  end;

  -- chaque objet, exactement comme sur la photo
  for r in select * from _acl_lu where quoi in ('rel', 'col', 'fn') order by quoi, objet loop
    v_n := v_n + pg_temp.converger(r.quoi, r.objet, r.acl);
  end loop;

  -- l'option de la vue
  for r in select * from _acl_lu where quoi = 'opt' loop
    if r.acl = '' then
      execute format('alter view public.%I reset (security_barrier)', r.objet);
    else
      execute format('alter view public.%I reset (security_barrier)', r.objet);
      execute format('alter view public.%I set (%s)', r.objet, r.acl);
    end if;
  end loop;

  -- vérification : la base = la photo, objet par objet
  select string_agg(d, ', ') into v_diff from (
    select coalesce(l.quoi, e.quoi) || ' ' || coalesce(l.objet, e.objet) as d
      from _acl_lu l full join pg_temp.etat_acl() e on e.quoi = l.quoi and e.objet = l.objet
     where l.acl is distinct from e.acl
     order by 1 limit 40) x;
  if v_diff is not null then
    raise exception 'RETOUR INCOMPLET — différent de la photo : %. Le retour est annulé en entier (la base reste comme avant ce retour).', v_diff;
  end if;
  raise notice 'Retour fait : % droit(s) remis ou retiré(s) ; chaque relation, colonne, fonction, droit par défaut = la photo (vérifié)%.',
    v_n, case when v_sa then '' else ' (droits par défaut de supabase_admin non touchés : pas le droit)' end;
end $$;

drop table if exists pg_temp._acl_lu;
"""

def ecrire(photo, dossier, date):
    rows = json.load(open(photo))
    lit = litteraux(rows, date)
    aller = ALLER_TETE.format(date=date) + lit + COMMUN + ALLER_CORPS
    retour = RETOUR_TETE.format(date=date) + lit + COMMUN + RETOUR_CORPS
    open(os.path.join(dossier, 'anon_aucun_droit.sql'), 'w').write(aller)
    open(os.path.join(dossier, 'anon_aucun_droit_retour.sql'), 'w').write(retour)

if __name__ == '__main__':
    if sys.argv[1] == 'lecture':
        print(LECTURE)
    elif sys.argv[1] == 'ecrire':
        ecrire(sys.argv[2], sys.argv[3], sys.argv[4])
