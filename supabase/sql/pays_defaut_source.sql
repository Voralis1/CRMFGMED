-- =====================================================================
-- Le pays par défaut d'une source — 21/10/2026
-- =====================================================================
--
-- Aucune des deux entreprises n'envoie de pays par l'API ; chacune n'a
-- qu'un pays. import-commande prenait donc « le seul pays de l'entreprise ».
-- Ce défaut dépendait de l'état de la table pays : le jour où un deuxième
-- pays est ajouté, toutes les sources qui comptaient dessus sont refusées,
-- sans que personne ne relie les deux faits.
--
-- Le défaut passe sur la SOURCE : une boutique vend dans un pays.
--   pays de l'API : le champ pays du lead → sources_import.pays_defaut →
--                   refus « pays manquant »
-- Ajouter un pays plus tard ne change plus rien.
--
--   · une source qui naît dans une entreprise à UN pays reçoit ce pays
--     (trigger, quel que soit le chemin : creer_source_api, anciennes portes,
--     éditeur SQL) ;
--   · les sources existantes le reçoivent de la même façon (§4) ;
--   · seul un responsable (gere_la_config) le change ; le vendeur le voit ;
--   · le pays doit être de la même entreprise que la source.
--
-- Exécutable en entier, et deux fois.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. La colonne
-- ---------------------------------------------------------------------
-- on delete set null : supprimer un pays ne supprime pas la boutique ; ses
-- leads sans pays seront refusés avec « pays manquant », ce qui se voit.
alter table public.sources_import
  add column if not exists pays_defaut uuid references public.pays(id) on delete set null;


-- ---------------------------------------------------------------------
-- 2. Le remplissage à la création, et la garde
-- ---------------------------------------------------------------------
create or replace function public.sources_pays_defaut()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  v_seul uuid;
begin
  -- Un responsable seulement (admin, manager, super_admin). Le vendeur a le
  -- droit de modifier SA source (couper, réactiver) : sans cette garde, il
  -- pourrait aussi déplacer ses leads dans un autre pays depuis la console.
  -- auth.uid() vide : éditeur SQL, service role — ce fichier lui-même.
  if tg_op = 'UPDATE'
     and new.pays_defaut is distinct from old.pays_defaut
     and auth.uid() is not null
     and not public.gere_la_config() then
    raise exception 'Seul un responsable change le pays par défaut d''une source'
      using errcode = '42501';
  end if;

  -- Une entreprise à un seul pays : la source naît avec ce pays. Le compte
  -- est lu ICI, à la naissance, et nulle part ailleurs : ajouter un pays
  -- plus tard ne retire rien à la source.
  if tg_op = 'INSERT' and new.pays_defaut is null then
    select min(p.id::text)::uuid into v_seul
      from public.pays p
     where p.tenant_id = new.tenant_id
    having count(*) = 1;
    new.pays_defaut := v_seul;
  end if;

  if new.pays_defaut is not null and not exists (
       select 1 from public.pays p
        where p.id = new.pays_defaut and p.tenant_id = new.tenant_id) then
    raise exception 'Ce pays n''appartient pas à l''entreprise de la source'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists tr_sources_pays_defaut on public.sources_import;
create trigger tr_sources_pays_defaut
  before insert or update of pays_defaut, tenant_id on public.sources_import
  for each row execute function public.sources_pays_defaut();


-- ---------------------------------------------------------------------
-- 3. Lisible par l'écran
-- ---------------------------------------------------------------------
-- authenticated n'a plus de SELECT sur toute la table (identifiants_api.sql
-- §7 : colonne par colonne, sans les secrets). Une colonne nouvelle est donc
-- invisible tant qu'on ne la donne pas. Ré-exécuter identifiants_api.sql
-- ferait la même chose ; cette ligne suffit.
grant select (pays_defaut) on public.sources_import to authenticated;


-- ---------------------------------------------------------------------
-- 4. Les sources existantes
-- ---------------------------------------------------------------------
-- Même règle qu'à la naissance : entreprise à un seul pays → ce pays. Une
-- entreprise à plusieurs pays garde ses sources sans défaut : à un
-- responsable de choisir sur « Mon API », on ne devine pas.
-- Rejouable : ne touche que les sources sans pays.
update public.sources_import s
   set pays_defaut = u.pays_id
  from (select p.tenant_id, min(p.id::text)::uuid as pays_id
          from public.pays p
         group by p.tenant_id
        having count(*) = 1) u
 where s.tenant_id = u.tenant_id
   and s.pays_defaut is null;


-- ---------------------------------------------------------------------
-- 5. Vérification — à lire, rien à changer
-- ---------------------------------------------------------------------
-- Attendu : chaque source avec un pays ; « sans pays » seulement dans une
-- entreprise qui en a plusieurs.
select s.nom as source, coalesce(p.nom, 'sans pays') as pays_defaut,
       (select count(*) from public.pays x where x.tenant_id = s.tenant_id) as pays_dans_l_entreprise
  from public.sources_import s
  left join public.pays p on p.id = s.pays_defaut
 order by s.created_at;
