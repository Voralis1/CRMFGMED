-- =============================================================================
-- ATTENTION — CE FICHIER MODIFIE DES COMMANDES EXISTANTES.
-- « Pending » : RATTRAPAGE — FICHIER 2 SUR 2 — 27/10/2026
-- À LANCER APRÈS statut_pending.sql ET APRÈS LA MISE EN LIGNE DES ÉCRANS
-- (Centre d'appel, Commandes) qui lisent « Pending ».
-- =============================================================================
--
-- Chaque commande dont statut_confirmation est NULL passe à « Pending ». Rien
-- d'autre n'est écrit : ni updated_at (l'ordre « dernière mise à jour » des
-- écrans ne bouge pas), ni l'agent, ni la livraison.
--
-- Puis la colonne devient NOT NULL, avec « Pending » par défaut : plus aucun
-- chemin ne peut recréer un lead sans statut.
--
-- Le résultat dit ce qui a été FAIT, par entreprise. Rejouable : au second
-- passage, 0 commande modifiée.
--
-- Pourquoi après les écrans : les écrans en ligne AVANT cette version
-- cherchent « IS NULL » (changement d'agent, filtre « Pas encore traité »,
-- historique). Lancé trop tôt, ces listes se videraient sans rien dire.
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.commandes'::regclass
                  and tgname = 'trg_aa_statut_pending') then
    raise exception 'Lancez d''abord statut_pending.sql (fichier 1) : rien n''a été modifié.';
  end if;
end $$;

drop table if exists _pending_rattrapage;
create temp table _pending_rattrapage (tenant_id uuid, n bigint);
with maj as (
  update public.commandes
     set statut_confirmation = 'Pending'
   where statut_confirmation is null
  returning tenant_id
)
insert into _pending_rattrapage
select tenant_id, count(*) from maj group by tenant_id;

alter table public.commandes alter column statut_confirmation set default 'Pending';
alter table public.commandes alter column statut_confirmation set not null;

commit;

-- Le résultat : ce qui a été fait.
select coalesce(t.nom_entreprise, r.tenant_id::text) as entreprise,
       r.n as commandes_passees_a_pending
  from _pending_rattrapage r
  left join public.tenants t on t.id = r.tenant_id
union all
select 'restant à NULL (doit être 0)', count(*) from public.commandes where statut_confirmation is null;
