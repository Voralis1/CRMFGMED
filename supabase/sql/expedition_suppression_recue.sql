-- =============================================================================
-- UNE EXPÉDITION REÇUE NE SE SUPPRIME PLUS — 10/11/2026 (T19, sa décision : (a))
-- NE MODIFIE AUCUNE DONNÉE. Ajoute 2 triggers (et leurs 2 fonctions).
-- =============================================================================
--
-- LE TROU (05/11, entreprise de test) : EXP-000035 (100 × product-a), reçue
-- puis SUPPRIMÉE depuis l'écran Expéditions — l'expédition est partie, son
-- mouvement « entree 100 » et le stock de 100 sont restés. Le stock contenait
-- alors des unités qu'aucune expédition n'explique.
-- Même trou, plus discret : modifier une expédition reçue et RETIRER une de ses
-- lignes (app/expeditions/page.js) — la ligne part, son stock reste.
--
-- SA DÉCISION (10/11) : (a) refuser. Une erreur se corrige par la QUANTITÉ
-- reçue (expeditions_quantite_recue.sql, 28/10 : le mouvement d'origine est
-- réécrit, le stock suit). Une ligne garde au moins 1 unité (contrainte
-- expeditions_produits_quantite_check) : un produit reçu par erreur se
-- corrige à 1, puis une « Sortie » de stock avec une note.
--
-- « Reçue » = entrepot_reception_id posé (c'est le moment où le stock entre ;
-- expedition_reception_figee s'appuie déjà dessus). Pas encore reçue (en
-- attente, refusée) : supprimable comme avant.
-- Une ligne reçue SANS mouvement (son produit a été supprimé :
-- recu_sans_mouvement) n'a pas de stock derrière elle : elle se retire.
-- Tout compte de l'application est concerné, super admin compris : supprimer
-- laisserait le stock faux quel que soit le rôle. L'éditeur SQL et le service
-- role (auth.uid() NULL) passent : les fichiers de nettoyage
-- (vider_donnees_operationnelles) vident tout, stock compris.
--
-- RETOUR ARRIÈRE : expedition_suppression_recue_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

create or replace function public.expedition_suppression_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;   -- éditeur SQL, service role, nettoyages
  end if;
  if old.entrepot_reception_id is not null then
    raise exception 'Cette expédition est déjà reçue : son stock est entré. Elle ne se supprime pas — corrigez sa quantité si elle est fausse.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke all on function public.expedition_suppression_garde() from public, anon, authenticated;
comment on function public.expedition_suppression_garde() is 'fichier: expedition_suppression_recue.sql';

drop trigger if exists trg_aa_expedition_suppression_recue on public.expeditions;
create trigger trg_aa_expedition_suppression_recue
  before delete on public.expeditions
  for each row execute function public.expedition_suppression_garde();

create or replace function public.expedition_ligne_suppression_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  if old.produit_id is not null
     and not coalesce(old.recu_sans_mouvement, false)
     and exists (select 1 from public.expeditions e
                  where e.id = old.expedition_id and e.entrepot_reception_id is not null) then
    raise exception 'Cette ligne est déjà reçue : son stock est entré. Elle ne se retire pas — corrigez sa quantité si elle est fausse.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke all on function public.expedition_ligne_suppression_garde() from public, anon, authenticated;
comment on function public.expedition_ligne_suppression_garde() is 'fichier: expedition_suppression_recue.sql';

drop trigger if exists trg_aa_expedition_ligne_suppression_recue on public.expeditions_produits;
create trigger trg_aa_expedition_ligne_suppression_recue
  before delete on public.expeditions_produits
  for each row execute function public.expedition_ligne_suppression_garde();

-- Vérification ------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_trigger
       where tgname in ('trg_aa_expedition_suppression_recue', 'trg_aa_expedition_ligne_suppression_recue')
         and tgenabled = 'O') <> 2 then
    raise exception 'expedition_suppression_recue.sql : les 2 gardes ne sont pas actives. Rien n''est installé.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'expeditions_produits' and column_name = 'recu_sans_mouvement') then
    raise exception 'expedition_suppression_recue.sql : expeditions_produits.recu_sans_mouvement absent (produits_historique_nom.sql). Rien n''est installé.';
  end if;
  raise notice 'expedition_suppression_recue.sql : une expédition (ou une ligne) reçue ne se supprime plus ; on corrige sa quantité. Aucune donnée modifiée.';
end $$;

commit;
