-- =============================================================================
-- RETOUR ARRIÈRE de expeditions_quantite_recue.sql
-- =============================================================================
-- Retire le trigger et les deux fonctions : changer la quantité d'une ligne
-- reçue redevient « l'expédition change, le stock reste ». Les corrections
-- DÉJÀ faites restent (mouvement réécrit, stock ajusté) : elles sont justes
-- au regard de la règle ; les défaire demanderait de connaître l'ancienne
-- valeur, que la règle a choisi de ne pas garder.
-- Exécutable deux fois, et même si le fichier n'a jamais tourné.
-- =============================================================================
drop trigger if exists trg_zz_expedition_quantite_recue on public.expeditions_produits;
drop function if exists public.expedition_quantite_recue();
drop function if exists public.corriger_quantite_recue(uuid, integer);
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_zz_expedition_quantite_recue') then
    raise exception 'Retour incomplet : le trigger est encore là.';
  end if;
  raise notice 'Retour fait : trigger et fonctions retirés. Les corrections déjà faites restent.';
end $$;
