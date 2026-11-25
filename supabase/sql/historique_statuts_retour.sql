-- =============================================================================
-- RETOUR ARRIÈRE de historique_statuts.sql — à coller si les écritures sur
-- commandes cassent après son installation.
-- =============================================================================
--
-- Retire les TROIS triggers, dans cet ordre :
--   1. trg_historique_statut (sur commandes) — c'est LUI qui peut bloquer
--      chaque insertion et chaque changement de statut. Retiré, les
--      écritures sur commandes refonctionnent ;
--   2. trg_historique_statuts_garde (sur historique_statuts) — il peut
--      bloquer la SUPPRESSION d'une commande (le SET NULL passe par lui) ;
--   3. trg_historique_statuts_garde_vider (même table, TRUNCATE).
-- Rien d'autre à retirer avant : un trigger dépend de sa fonction, jamais
-- l'inverse ; la vue et la clé étrangère ne dépendent d'aucun trigger.
--
-- Ce qui RESTE, exprès : la table et ses lignes (l'historique déjà écrit),
-- la vue, les fonctions. enregistrer_appel continue de marcher sans les
-- triggers (il écrit l'appel et la commande ; les réglages qu'il pose ne
-- sont plus lus par personne) : confirmer-appel n'a PAS besoin d'être
-- redéployé.
-- Après ce retour : plus aucune ligne d'historique n'est écrite, et les
-- lignes existantes ne sont plus protégées.
--
-- Exécutable en entier, deux fois, et même si historique_statuts.sql n'a
-- jamais tourné ou s'est arrêté au milieu.
-- Pour réinstaller : relancer historique_statuts.sql (rejouable).
--
-- SI C'EST confirmer-appel QUI CASSE (enregistrer un appel échoue, pas une
-- écriture SQL) : ce bloc n'y change rien. Remettre l'ancienne fonction,
-- dans le dossier du projet, ces deux commandes :
--
--   git checkout HEAD -- supabase/functions/confirmer-appel/index.ts
--   npx supabase functions deploy confirmer-appel
--
-- (Si le changement a déjà été commité : remplacer HEAD par 8f98940.)
-- L'ancienne fonction n'a pas besoin de enregistrer_appel : elle marche avec
-- ou sans l'historique installé.
-- =============================================================================
do $$
begin
  drop trigger if exists trg_historique_statut on public.commandes;
  if to_regclass('public.historique_statuts') is not null then
    drop trigger if exists trg_historique_statuts_garde on public.historique_statuts;
    drop trigger if exists trg_historique_statuts_garde_vider on public.historique_statuts;
  end if;

  if exists (select 1 from pg_trigger
              where tgname in ('trg_historique_statut', 'trg_historique_statuts_garde',
                               'trg_historique_statuts_garde_vider')) then
    raise exception 'Retour incomplet : un trigger d''historique est encore là.';
  end if;
  raise notice 'Retour fait : les trois triggers d''historique sont retirés. Table, lignes et vue gardées.';
end $$;
