-- =============================================================================
-- RETOUR ARRIÈRE de renvoyer_en_attente.sql — à coller si les écritures sur
-- commandes cassent après son installation (créer une commande, changer un
-- statut).
-- =============================================================================
--
-- Remet la fonction de trg_aa_statut_pending EXACTEMENT comme
-- statut_pending.sql l'a installée le 27/10 : NULL → « Pending », et tout
-- retour à « Pending » refusé (le bouton « Renvoyer en attente » ne marchera
-- plus, avec ce message-là). C'est la seule partie du fichier qui tourne à
-- chaque écriture sur commandes.
--
-- Ce qui RESTE, exprès : `appels` fermé aux agents et commandes.entree_file —
-- ni l'un ni l'autre ne touche une écriture sur commandes, et la page du
-- Centre d'appel a besoin d'entree_file.
--
-- Si c'est l'HISTORIQUE qui casse les écritures : RETOUR_historique_statuts.sql.
--
-- SI C'EST confirmer-appel QUI CASSE (enregistrer un appel échoue) : ce bloc
-- n'y change rien. Dans le dossier du projet :
--
--   git checkout HEAD -- supabase/functions/confirmer-appel/index.ts
--   npx supabase functions deploy confirmer-appel
--
-- (HEAD = le dernier commit ; si ce changement a déjà été commité, remplacer
-- HEAD par c6aac3e, la version d'historique_statuts qui marche.)
-- Exécutable deux fois.
-- =============================================================================
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
$$;
-- Marque (02/11) : le corps remis est celui de statut_pending.sql — il porte sa marque,
-- pour qu'un nouveau passage de statut_pending.sql ne s'arrête pas sur une marque fausse.
comment on function public.statut_pending_commande() is 'fichier: statut_pending.sql';

do $$
begin
  if (select prosrc from pg_proc where oid = 'public.statut_pending_commande()'::regprocedure)
       ilike '%Renvoi refusé%' then
    raise exception 'Retour incomplet : la fonction a encore le corps de renvoyer_en_attente.sql.';
  end if;
  raise notice 'Retour fait : trg_aa_statut_pending a de nouveau le corps du 27/10 (tout retour à Pending refusé).';
end $$;
