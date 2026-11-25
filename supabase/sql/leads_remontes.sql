-- =============================================================================
-- Remonter des leads dans la file de l'agent — 27/10/2026
-- =============================================================================
--
-- Un manager ou un admin remonte, en un clic, tous les « Unreached » que ses
-- filtres retiennent. Le lead GARDE son statut (un Unreached reste Unreached) :
-- seule sa place dans la liste de l'agent change. Le « remonté » est donc une
-- MARQUE à côté du statut, pas un statut.
--
-- LA MARQUE : commandes.remonte_le (timestamptz, NULL = pas remonté) et
-- commandes.remonte_par (qui). Une date plutôt qu'un booléen :
--   · elle ORDONNE : dans la file, les remontés passent en premier, le plus
--     anciennement remonté d'abord ;
--   · elle dit quand et qui, sans table de plus ;
--   · effacer = remettre NULL.
--
-- QUAND ELLE S'EFFACE : dès qu'un appel est enregistré sur la commande
-- (trigger sur `appels`), quel que soit le statut choisi. Sinon un lead remonté
-- une fois resterait en tête pour toujours, et le bouton ne voudrait plus rien
-- dire. « Un appel enregistré » couvre confirmer-appel (l'agent, et le manager
-- qui corrige un statut depuis Commandes), sans déploiement.
--
-- QUI LA POSE : admin, manager, super_admin, par remonter_leads() — ni le ceo
-- (il lit, n'arbitre pas), ni un agent, ni un vendeur, même depuis la console :
-- un trigger refuse toute autre écriture d'une marque non nulle.
--
-- CE QUI SE REMONTE : un lead dont le statut est ouvert (ferme_le_lead =
-- false), qui n'est ni « Pending » (déjà en tête) ni un rappel
-- (necessite_rappel : en tête aussi, jusqu'à la fonctionnalité C) — c'est-à-
-- dire « Unreached » et tout statut de ce genre ajouté plus tard. Lu sur les
-- drapeaux, pas sur le nom.
--
-- Aucune commande existante n'est modifiée. Exécutable en entier, et deux fois.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Prérequis (30/10) : « Remonter » lit la permission « Actions en masse ».
do $$
begin
  if to_regprocedure('public.a_la_permission(text)') is null then
    raise exception 'public.a_la_permission(text) manque (rls_sources_import.sql) : « Actions en masse » ne pourrait pas être lue. Rien n''a été installé.';
  end if;
end $$;

-- 1. Les colonnes
-- -----------------------------------------------------------------------------
alter table public.commandes add column if not exists remonte_le  timestamptz;
alter table public.commandes add column if not exists remonte_par uuid
  references auth.users(id) on delete set null;

-- La file de l'agent lit les remontés en premier.
create index if not exists idx_commandes_remonte_le
  on public.commandes (tenant_id, remonte_le) where remonte_le is not null;


-- -----------------------------------------------------------------------------
-- 2. Qui peut poser la marque
-- -----------------------------------------------------------------------------
-- auth.uid() NULL (clé service, éditeur SQL, le trigger du §4) : libre.
-- Effacer (NULL) : libre — c'est ce que fait un appel.
create or replace function public.remonte_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or new.remonte_le is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.remonte_le is not distinct from old.remonte_le
     and new.remonte_par is not distinct from old.remonte_par then
    return new;
  end if;
  if not (public.is_super_admin() or lower(coalesce(public.mon_role(), '')) in ('admin', 'manager')) then
    raise exception 'Seuls un manager ou un admin remontent des leads.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.remonte_garde() from public, anon, authenticated;

create or replace trigger trg_remonte_garde
  before insert or update of remonte_le, remonte_par on public.commandes
  for each row execute function public.remonte_garde();


-- -----------------------------------------------------------------------------
-- 3. Le bouton : remonter_leads(entreprise, ids)
-- -----------------------------------------------------------------------------
-- L'écran envoie les ids des leads que ses filtres retiennent ; la base ne
-- garde que ce qui se remonte vraiment (entreprise, statut, livraison en
-- cours, pas déjà remonté) et rend le nombre de leads remontés.
-- Un lead déjà remonté garde sa date : le remonter encore ne le ferait pas
-- passer devant ceux qui attendent depuis plus longtemps.
create or replace function public.remonter_leads(p_tenant uuid, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if not (public.is_super_admin()
          or (lower(coalesce(public.mon_role(), '')) in ('admin', 'manager')
              and p_tenant = public.get_my_tenant_id())) then
    raise exception 'Seuls un manager ou un admin de cette entreprise remontent des leads.' using errcode = '42501';
  end if;
  -- « Remonter » est une action en masse (30/10) : tous les Non joint que les
  -- filtres retiennent, d'un clic. La permission en plus du rôle ci-dessus.
  if not (public.is_super_admin() or public.a_la_permission('actions_masse')) then
    raise exception 'Actions en masse : votre rôle ne permet pas de remonter des leads.' using errcode = '42501';
  end if;

  update public.commandes c
     set remonte_le = now(), remonte_par = auth.uid()
   where c.id = any(p_ids)
     and c.tenant_id = p_tenant
     and c.remonte_le is null
     and coalesce(c.statut_livraison, '') not in ('livre', 'retour', 'annule')
     and exists (select 1 from public.statuts s
                  where s.tenant_id = c.tenant_id
                    and s.nom = c.statut_confirmation
                    and (s.pays_id is null or s.pays_id = c.pays_id)
                    and not s.ferme_le_lead
                    and not s.necessite_rappel
                    and s.code <> 'pending');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.remonter_leads(uuid, uuid[]) from public, anon;
grant execute on function public.remonter_leads(uuid, uuid[]) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. Un appel enregistré efface la marque
-- -----------------------------------------------------------------------------
create or replace function public.remonte_efface_apres_appel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.commandes
     set remonte_le = null, remonte_par = null
   where id = new.commande_id and remonte_le is not null;
  return new;
end;
$$;

revoke all on function public.remonte_efface_apres_appel() from public, anon, authenticated;

create or replace trigger trg_appels_efface_remonte
  after insert on public.appels
  for each row execute function public.remonte_efface_apres_appel();


-- -----------------------------------------------------------------------------
-- 5. Vérification
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'commandes' and column_name = 'remonte_le') then
    raise exception 'commandes.remonte_le absente.';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.commandes'::regclass
                  and tgname = 'trg_remonte_garde' and tgenabled <> 'D')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.appels'::regclass
                  and tgname = 'trg_appels_efface_remonte' and tgenabled <> 'D') then
    raise exception 'trg_remonte_garde ou trg_appels_efface_remonte absent ou désactivé.';
  end if;
  if has_function_privilege('anon', 'public.remonter_leads(uuid,uuid[])', 'execute') then
    raise exception 'remonter_leads est encore exécutable par anon.';
  end if;
  raise notice 'leads_remontes.sql : en place. Aucune commande modifiée.';
end $$;
