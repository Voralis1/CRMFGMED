-- =============================================================================
-- « LIVRÉE » SEULEMENT APRÈS « EXPÉDIÉE » — 05/11/2026
-- NE MODIFIE AUCUNE DONNÉE. Ajoute une règle (1 trigger, 2 fonctions).
-- À lancer APRÈS stock_regles.sql et stock_livraison_autre_vendeur.sql (05/11).
-- =============================================================================
--
-- SA DÉCISION (05/11, test de l'entreprise de test : TEST-B passé « Livré »
-- directement depuis « À préparer », le stock est sorti sans aucun contrôle) :
--   un colis passe TOUJOURS par « Expédiée » avant « Livrée ». C'est à
--   « Expédiée » que le stock est vérifié et sorti (stock_livraison_autre_
--   vendeur.sql) ; un « Livré » direct sautait ce contrôle.
--   Pour TOUT LE MONDE (livreur, manager, super admin, fonction
--   confirmer-livraison, éditeur SQL) : une seule règle, posée sur la table,
--   tient sur tous les chemins.
--   « Retour » et « Annulé » : inchangés.
--   Conséquence voulue : sans stock, « Expédiée » est refusée, donc le colis
--   ne part pas (le stock est déjà vérifié à la confirmation).
--   Les livraisons déjà « livrée » ne bougent pas.
--
-- CE QUE FAIT LE FICHIER :
--   §1 livraison_saut_livre(ancien, nouveau) : LA règle, en une ligne.
--   §2 trg_aa_livraison_expediee_avant (BEFORE INSERT / UPDATE OF statut,
--      premier des triggers BEFORE) : refuse « livre » si la livraison n'était
--      pas « expedie » (une création directement « livre » aussi).
--   §3 répétition : la règle sur tous les cas (un fichier fautif s'arrête là,
--      rien n'est installé) + le trigger est posé et actif.
--
-- RETOUR ARRIÈRE : livraison_expediee_avant_retour.sql (copie sur le Bureau).
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.stock_disponible(uuid, uuid, uuid, uuid)') is null then
    raise exception 'livraison_expediee_avant.sql : lancez d''abord stock_regles.sql. Rien n''est installé.';
  end if;
end $$;

-- §1 La règle -----------------------------------------------------------------------
-- Vrai = le passage est refusé : on arrive à « livre » sans venir de « expedie ».
-- Déjà « livre » → « livre » : pas un passage, rien à refuser.
create or replace function public.livraison_saut_livre(p_ancien text, p_nouveau text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_nouveau = 'livre' and coalesce(p_ancien, '') not in ('expedie', 'livre');
$$;
revoke all on function public.livraison_saut_livre(text, text) from public, anon, authenticated;
comment on function public.livraison_saut_livre(text, text) is 'fichier: livraison_expediee_avant.sql';

-- §2 Le trigger -----------------------------------------------------------------------
create or replace function public.livraison_expediee_avant()
returns trigger
language plpgsql
security definer   -- la règle est fermée aux comptes : le trigger l'appelle en propriétaire
set search_path = public
as $$
begin
  if public.livraison_saut_livre(case when tg_op = 'UPDATE' then old.statut end, new.statut) then
    raise exception 'Mettez d''abord la livraison en « Expédiée » : c''est là que le stock est vérifié et sorti.';
  end if;
  return new;
end;
$$;
revoke all on function public.livraison_expediee_avant() from public, anon, authenticated;
comment on function public.livraison_expediee_avant() is 'fichier: livraison_expediee_avant.sql';

drop trigger if exists trg_aa_livraison_expediee_avant on public.livraisons;
create trigger trg_aa_livraison_expediee_avant
  before insert or update of statut on public.livraisons
  for each row execute function public.livraison_expediee_avant();

-- §3 Répétition -------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in select * from (values
      ('a_preparer', 'livre',   true),
      (null,         'livre',   true),
      ('retour',     'livre',   true),
      ('annule',     'livre',   true),
      ('expedie',    'livre',   false),
      ('livre',      'livre',   false),
      ('a_preparer', 'expedie', false),
      ('a_preparer', 'annule',  false),
      ('expedie',    'retour',  false),
      ('expedie',    'annule',  false)) v(ancien, nouveau, refuse)
  loop
    if public.livraison_saut_livre(c.ancien, c.nouveau) is distinct from c.refuse then
      raise exception 'livraison_expediee_avant.sql : la règle se trompe pour % → % (attendu : %). Rien n''est installé.',
        coalesce(c.ancien, 'création'), c.nouveau, case when c.refuse then 'refusé' else 'accepté' end;
    end if;
  end loop;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.livraisons'::regclass
                    and tgname = 'trg_aa_livraison_expediee_avant' and tgenabled = 'O') then
    raise exception 'livraison_expediee_avant.sql : le trigger n''est pas actif. Rien n''est installé.';
  end if;

  raise notice 'livraison_expediee_avant.sql : « Livrée » refusée tant que la livraison n''est pas « Expédiée ». Aucune donnée modifiée.';
end $$;

commit;
