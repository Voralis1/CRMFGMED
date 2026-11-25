-- =============================================================================
-- GARDE DES DÉFINITIONS — marque les 7 fonctions définies dans deux fichiers
-- 02/11/2026
-- =============================================================================
--
-- NE CHANGE AUCUNE FONCTION, AUCUNE DONNÉE. Pose seulement un commentaire
-- (« fichier: <nom>.sql ») sur sept fonctions et une vue : le fichier qui les définit
-- aujourd'hui.
--
-- POURQUOI : un fichier plus ancien en contient une copie plus ancienne ;
-- le relancer remettait en silence l'ancien corps. Depuis le 02/11, ces
-- fichiers plus anciens lisent la marque et ne réécrivent plus une fonction
-- marquée par un fichier plus récent (un avis le dit, rien n'échoue) :
--
--   fonction                    définie par                      copie ancienne dans
--   produits_en_stock           produits_proprietaire.sql        entrepot_commande.sql
--   fn_ajuster_stock_livraison  stock_livraison_autre_vendeur    entrepot_commande, nettoyage_triggers_14_10
--   statut_pending_commande     renvoyer_en_attente.sql          statut_pending.sql
--   stats_dashboard             commandes_produit_id.sql         statut_pending.sql
--   auto_affecter_livreur       livreur_par_zone.sql             correctif_urgent_14_10.sql
--   choisir_livreur             livreur_par_zone.sql             nettoyage_triggers_14_10.sql
--   ecrire_historique_statut    commandes_statut_lot.sql         historique_statuts.sql
--   vue v_historique_statuts    commandes_statut_lot.sql         historique_statuts.sql
--     (sans garde, relancer historique_statuts.sql échouait en entier :
--      « cannot drop columns from view » — la vue de prod a lot_id)
--
-- Les fichiers qui définissent ces fonctions posent la même marque à chaque
-- passage. Celui-ci ne sert qu'une fois : marquer ce qui est déjà en place.
--
-- SÛRETÉ : il ne marque une fonction que si son corps est EXACTEMENT celui
-- du fichier qui la définit (md5 lu en production le 02/11, identique au
-- fichier) ; la vue seulement si elle a la colonne lot_id. Un seul écart, une marque étrangère ou une fonction absente →
-- RIEN n'est marqué, le message dit laquelle. Rejouable : une fonction déjà
-- marquée par le bon fichier est laissée telle quelle.
--
-- RETOUR ARRIÈRE : garde_definitions_retour.sql (efface ces sept marques).
-- =============================================================================

begin;

do $$
declare
  r      record;
  v_md5  text;
  v_c    text;
  v_n    integer := 0;
  v_deja integer := 0;
begin
  for r in
    select * from (values
      ('public.produits_en_stock(uuid, uuid[])',                   'ada9a6a777f3dac5c46aa3d5f432e0de', 'produits_proprietaire.sql'),
      ('public.fn_ajuster_stock_livraison()',                      '8226f286b1d0731294abcabb6cbc7ce4', 'stock_livraison_autre_vendeur.sql'),
      ('public.statut_pending_commande()',                         '78176ec3baeccc7d9c8c39970deb60b1', 'renvoyer_en_attente.sql'),
      ('public.stats_dashboard(uuid, timestamptz, timestamptz)',   '376fa0fc31d11e0ec9c69f6d87ab94fb', 'commandes_produit_id.sql'),
      ('public.auto_affecter_livreur()',                           'b9f604fa62a038ef8b8fd940ecdc09bc', 'livreur_par_zone.sql'),
      ('public.choisir_livreur(uuid, uuid, text, uuid)',           'fa9e0378d533b0aed933f75028156cd5', 'livreur_par_zone.sql'),
      ('public.ecrire_historique_statut()',                        '6555320b93a3b7f63bbdd863c869d36d', 'commandes_statut_lot.sql')
    ) v(fonction, md5_attendu, fichier)
  loop
    if to_regprocedure(r.fonction) is null then
      raise exception '% absente. Rien n''a été marqué.', r.fonction;
    end if;
    select md5(prosrc), obj_description(oid, 'pg_proc') into v_md5, v_c
      from pg_proc where oid = to_regprocedure(r.fonction);
    if v_c = 'fichier: ' || r.fichier then
      v_deja := v_deja + 1;
      continue;
    end if;
    if v_c is not null then
      raise exception '% porte déjà le commentaire « % ». Rien n''a été marqué.', r.fonction, v_c;
    end if;
    if v_md5 <> r.md5_attendu then
      raise exception '% n''a plus le corps de % (md5 %, attendu %) : quelqu''un l''a changée depuis le 02/11. Rien n''a été marqué.',
        r.fonction, r.fichier, v_md5, r.md5_attendu;
    end if;
    execute format('comment on function %s is %L', r.fonction, 'fichier: ' || r.fichier);
    v_n := v_n + 1;
  end loop;

  -- La vue : celle de commandes_statut_lot.sql est celle qui a lot_id.
  v_c := obj_description(to_regclass('public.v_historique_statuts'), 'pg_class');
  if to_regclass('public.v_historique_statuts') is null then
    raise exception 'v_historique_statuts absente. Rien n''a été marqué.';
  elsif v_c = 'fichier: commandes_statut_lot.sql' then
    v_deja := v_deja + 1;
  elsif v_c is not null then
    raise exception 'v_historique_statuts porte déjà le commentaire « % ». Rien n''a été marqué.', v_c;
  elsif not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'v_historique_statuts' and column_name = 'lot_id') then
    raise exception 'v_historique_statuts n''a pas lot_id : ce n''est pas celle de commandes_statut_lot.sql. Rien n''a été marqué.';
  else
    comment on view public.v_historique_statuts is 'fichier: commandes_statut_lot.sql';
    v_n := v_n + 1;
  end if;

  -- Vérification : chaque copie ancienne verra une marque qui la fait passer
  -- son tour. Même liste que les gardes des fichiers anciens.
  for r in
    select * from (values
      ('entrepot_commande.sql',          'public.produits_en_stock(uuid, uuid[])',                 array['fichier: produits_proprietaire.sql']),
      ('entrepot_commande.sql',          'public.fn_ajuster_stock_livraison()',                    array['fichier: stock_livraison_autre_vendeur.sql']),
      ('nettoyage_triggers_14_10.sql',   'public.fn_ajuster_stock_livraison()',                    array['fichier: entrepot_commande.sql', 'fichier: stock_livraison_autre_vendeur.sql']),
      ('nettoyage_triggers_14_10.sql',   'public.choisir_livreur(uuid, uuid, text, uuid)',         array['fichier: livreur_par_zone.sql']),
      ('statut_pending.sql',             'public.statut_pending_commande()',                       array['fichier: renvoyer_en_attente.sql']),
      ('statut_pending.sql',             'public.stats_dashboard(uuid, timestamptz, timestamptz)', array['fichier: commandes_produit_id.sql']),
      ('correctif_urgent_14_10.sql',     'public.auto_affecter_livreur()',                         array['fichier: livreur_par_zone.sql']),
      ('historique_statuts.sql',         'public.ecrire_historique_statut()',                      array['fichier: commandes_statut_lot.sql'])
    ) v(ancien, fonction, plus_recents)
  loop
    v_c := obj_description(to_regprocedure(r.fonction), 'pg_proc');
    if v_c is null or not (v_c = any (r.plus_recents)) then
      raise exception 'Vérification : % réécrirait encore % (marque « % »). Rien n''a été marqué.',
        r.ancien, r.fonction, coalesce(v_c, 'aucune');
    end if;
  end loop;

  if obj_description(to_regclass('public.v_historique_statuts'), 'pg_class') is distinct from 'fichier: commandes_statut_lot.sql' then
    raise exception 'Vérification : historique_statuts.sql réécrirait encore v_historique_statuts. Rien n''a été marqué.';
  end if;

  raise notice 'garde_definitions.sql : % objet(s) marqué(s), % déjà marquée(s). Aucune fonction, aucune donnée modifiée.', v_n, v_deja;
end $$;

commit;

-- Ce qui est en place : huit lignes (7 fonctions + la vue), une marque chacune.
select p.oid::regprocedure::text as objet, obj_description(p.oid, 'pg_proc') as marque
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and obj_description(p.oid, 'pg_proc') like 'fichier: %'
union all
select 'vue v_historique_statuts', obj_description(to_regclass('public.v_historique_statuts'), 'pg_class')
 order by 1;
