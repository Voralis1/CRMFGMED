-- =============================================================================
-- RETOUR ARRIÈRE de statuts_entreprise.sql (30/10/2026)
-- =============================================================================
-- Remet l'état d'avant : plus de trigger sur tenants, plus de clé
-- statuts → tenants, statut_pending_fige = le corps de production du 30/10
-- (md5 d93c86ab4da035fd9f431341f78d4f00, vérifié à la fin).
-- NE remet PAS les 7 statuts orphelins de l'entreprise supprimée 53ef8d4e…
-- (ils ne servaient à rien ; leurs valeurs sont dans statuts_entreprise.sql §3
-- et §1). NE retire AUCUN statut semé : une entreprise créée entre-temps garde
-- les siens (les retirer lui ôterait son vocabulaire).
-- ⚠ Après ce retour, supprimer une entreprise est de nouveau refusé par le
-- « Pending » figé — y compris le nettoyage de creer-tenant quand une création
-- échoue. Et relancer statut_pending.sql (qui porte le nouveau corps depuis le
-- 30/10) remettrait l'exception de la cascade : sans danger.
-- Exécutable en entier, et deux fois.
-- =============================================================================

drop trigger if exists trg_tenants_semer_statuts on public.tenants;
drop function if exists public.tenants_semer_statuts();
drop function if exists public.semer_statuts(uuid);
drop function if exists public.statuts_standard_liste();
alter table public.statuts drop constraint if exists statuts_tenant_id_fkey;

create or replace function public.statut_pending_fige()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.code = 'pending' then
    if tg_op = 'DELETE' then
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
-- Le corps de production est SECURITY INVOKER (vérifié ci-dessous).
alter function public.statut_pending_fige() security invoker;

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.statut_pending_fige()'::regprocedure)
     <> 'd93c86ab4da035fd9f431341f78d4f00' then
    raise exception 'statut_pending_fige : le corps remis n''est pas celui de production (md5).';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.statut_pending_fige()'::regprocedure) then
    raise exception 'statut_pending_fige est encore SECURITY DEFINER.';
  end if;
  raise notice 'Retour de statuts_entreprise.sql : fait.';
end $$;
