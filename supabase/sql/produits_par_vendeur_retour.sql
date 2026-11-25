-- =============================================================================
-- RETOUR ARRIÈRE de produits_par_vendeur.sql — 10/11/2026
-- Remet : le code unique par ENTREPRISE, commande_produit_id de
-- commandes_produit_id.sql (md5 ff50911c…, toute l'entreprise), son trigger
-- d'avant (sans vendeur_id), remplir_produits_commandes d'avant. Retire produit_de_commande_vendeur.
-- REFUSE tant que deux vendeurs d'une entreprise ont le même code (l'index
-- d'avant ne pourrait pas revenir) : renommez l'un des deux d'abord.
-- Les commandes ne bougent pas. Rejouable.
-- =============================================================================
begin;

do $$
declare d text;
begin
  select string_agg(format('%s → "%s" ×%s', tenant_id, c, n), '; ') into d
    from (select tenant_id, lower(btrim(code)) c, count(*) n from public.produits
           where code is not null and btrim(code) <> '' group by 1, 2 having count(*) > 1) x;
  if d is not null then
    raise exception 'produits_par_vendeur_retour.sql : des vendeurs partagent un code (%) — renommez-en un d''abord. Rien n''est retiré.', d;
  end if;
end $$;

drop index if exists public.idx_produits_code_unique;
create unique index idx_produits_code_unique
  on public.produits (tenant_id, lower(btrim(code)))
  where code is not null and btrim(code) <> '';

create or replace function public.commande_produit_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.produit is distinct from old.produit
     or new.tenant_id is distinct from old.tenant_id then
    select r.produit_id into new.produit_id
      from public.produit_de_commande(new.tenant_id, new.produit) r;
    return new;
  end if;

  if new.produit_id is not distinct from old.produit_id then
    return new;
  end if;
  if coalesce(current_setting('crm.produit_rattrapage', true), '') = 'oui' then
    return new;
  end if;
  if new.produit_id is null
     and not exists (select 1 from public.produits where id = old.produit_id) then
    return new; -- le produit vient d'être supprimé : la commande passe en « non reconnu »
  end if;
  raise exception 'Le produit d''une commande se déduit de son texte (« % ») : produit_id ne s''écrit pas à la main.', new.produit;
end;
$$;
revoke all on function public.commande_produit_id() from public, anon, authenticated;
comment on function public.commande_produit_id() is 'fichier: commandes_produit_id.sql';

create or replace trigger trg_zz_produit_commande
  before insert or update of produit, produit_id, tenant_id on public.commandes
  for each row execute function public.commande_produit_id();

create or replace function public.remplir_produits_commandes()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  perform set_config('crm.produit_rattrapage', 'oui', true);
  update public.commandes c
     set produit_id = r.produit_id
    from (select c2.id, x.produit_id
            from public.commandes c2
            cross join lateral public.produit_de_commande(c2.tenant_id, c2.produit) x
           where c2.produit_id is null) r
   where c.id = r.id and r.produit_id is not null;
  get diagnostics v_n = row_count;
  perform set_config('crm.produit_rattrapage', '', true);
  return v_n;
end;
$$;
revoke all on function public.remplir_produits_commandes() from public, anon, authenticated;
comment on function public.remplir_produits_commandes() is 'fichier: commandes_produit_id.sql';

drop function if exists public.produit_de_commande_vendeur(uuid, text, uuid);

do $$
begin
  if md5((select prosrc from pg_proc where oid = to_regprocedure('public.commande_produit_id()'))) <> 'ff50911c45a7696eae7f06f3d51a87cd'
     or exists (select 1 from pg_indexes where indexname = 'idx_produits_code_unique' and indexdef ilike '%vendeur_id%') then
    raise exception 'produits_par_vendeur_retour.sql : le retour n''est pas complet. Rien n''est retiré.';
  end if;
  raise notice 'produits_par_vendeur_retour.sql : code unique par entreprise et recherche dans toute l''entreprise remis.';
end $$;

commit;
