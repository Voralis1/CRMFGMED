-- ⚠ RETIRÉ LE 12/11/2026 (sa décision) par marges_retour.sql — NE PAS RELANCER.
--   Remplacé par le simulateur de rentabilité (page seule, rien d'enregistré).
--   Gardé pour l'historique (comme correspondances_sku le 03/11).
-- =============================================================================
-- MARGES : « MARGE FGMED » (A) ET « MARGE PRODUITS » (B) — 12/11/2026 (sa décision : les deux, séparés)
-- NE MODIFIE AUCUNE DONNÉE EXISTANTE. Ajoute 1 permission, 3 tables de coûts, 1 colonne
-- (livraisons.statut_le), 2 calculs.
-- =============================================================================
--
-- CONFIDENTIEL (doc du CEO §5, sa décision 09/11) : coûts, marges, profit = super
-- admin et l'ADMIN de l'entreprise seulement. Jamais vendeur, agent, livreur,
-- manager, CEO. Fermé ICI, pas seulement à l'écran : permission « voir_marges »
-- (par défaut admin + super admin, modifiable dans Rôles), lue par la RLS des
-- 3 tables et par les 2 calculs.
--
-- A · MARGE FGMED (ce que FGMED gagne sur son service), par pays et par vendeur :
--   revenus = les frais facturés au vendeur sur chaque commande LIVRÉE de la
--     période (frais commande + livraison + upsell) — les montants COPIÉS sur le
--     relevé quand elle y est, sinon le tarif du jour de livraison (même règle que
--     etablir_releve). Pas le % de transfert : il paie le service de transfert,
--     ce n'est pas un gain. Pas les ajustements (pénalités…).
--   coûts (couts_fgmed, par pays, à partir d'une date) :
--     · par commande livrée (livreur) · par commande en retour (le trajet est fait)
--     · par lead confirmé (centre d'appel) — compté le jour de SA PREMIÈRE confirmation ;
--   coûts fixes du mois (couts_fixes, par pays et par mois) : comptés au prorata
--     des jours de la période (une semaine = 7/30 du mois), puis RÉPARTIS entre
--     les vendeurs du pays selon leurs commandes livrées ; sans livraison dans
--     la période → une ligne « Non réparti ».
--   marge = revenus − coûts.
--
-- B · MARGE PRODUITS (le produit gagne-t-il de l'argent ?), par produit et par pays :
--   encaissé (le paiement réel, sinon le prix) − unités × coût d'achat du jour
--   de livraison (couts_produits, à partir d'une date) − frais FGMED.
--   Un produit dont une commande n'a pas de coût saisi : marge VIDE (« coût non
--   saisi »), jamais un faux profit.
--
-- La date d'un RETOUR n'existait pas (date_livraison n'est posée qu'à « livré ») :
-- livraisons.statut_le est posée à chaque changement de statut, à partir de
-- maintenant ; les anciennes lignes lisent date_livraison, sinon created_at.
-- Les commandes supprimées ne comptent pas (leur livraison est partie avec).
-- Montants dans la devise du pays : jamais additionnés entre pays.
--
--   §1 prérequis ; §2 permission ; §3 statut_le ; §4 tables ; §5 calculs ; §6 contrôles ;
--   §7 répétition (annulée) dans l'entreprise de test.
--
-- RETOUR ARRIÈRE : marges_retour.sql (copie sur le Bureau) — LES COÛTS SAISIS SONT PERDUS.
-- =============================================================================

begin;

-- §1 Prérequis ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.tarif_applicable(uuid, uuid, uuid, date)') is null
     or to_regprocedure('public.a_la_permission(text)') is null then
    raise exception 'marges.sql : lancez d''abord frais_vendeurs.sql (tarif_applicable). Rien n''est installé.';
  end if;
end $$;

-- §2 Permission (ajoutée une fois ; il la coche ensuite dans Rôles) --------------------
do $$
begin
  if not exists (select 1 from public.permissions where code = 'voir_marges') then
    insert into public.permissions (code, nom, module, description)
    values ('voir_marges', 'Voir et saisir coûts et marges', 'Finance',
            'Coûts FGMED, coûts d''achat des produits, marges et profit. Confidentiel : admin et super admin');
    insert into public.role_permissions (role_id, permission_code)
    select r.id, 'voir_marges' from public.roles r
     where r.nom in ('admin', 'super_admin') and r.tenant_id is null
    on conflict do nothing;
  end if;
end $$;

-- §3 La date du dernier statut d'une livraison ------------------------------------------
alter table public.livraisons add column if not exists statut_le timestamptz;

create or replace function public.livraison_statut_le()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.statut is distinct from old.statut then
    new.statut_le := now();
  end if;
  return new;
end;
$$;
revoke all on function public.livraison_statut_le() from public, anon, authenticated;
comment on function public.livraison_statut_le() is 'fichier: marges.sql';
drop trigger if exists trg_ab_livraison_statut_le on public.livraisons;
create trigger trg_ab_livraison_statut_le
  before insert or update of statut on public.livraisons
  for each row execute function public.livraison_statut_le();

-- §4 Les tables de coûts --------------------------------------------------------------
create table if not exists public.couts_fgmed (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  pays_id            uuid not null references public.pays(id) on delete cascade,
  cout_livraison     numeric not null default 0 check (cout_livraison >= 0),
  cout_retour        numeric not null default 0 check (cout_retour >= 0),
  cout_confirmation  numeric not null default 0 check (cout_confirmation >= 0),
  valide_depuis      date not null default current_date,
  cree_par           uuid default auth.uid(),
  cree_le            timestamptz not null default now()
);
comment on table public.couts_fgmed is 'fichier: marges.sql — coûts de FGMED par commande livrée / en retour / lead confirmé, par pays, à partir d''une date. Confidentiel (voir_marges).';
create unique index if not exists couts_fgmed_un_par_jour on public.couts_fgmed (tenant_id, pays_id, valide_depuis);

create table if not exists public.couts_fixes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  pays_id    uuid not null references public.pays(id) on delete cascade,
  mois       date not null check (mois = date_trunc('month', mois)::date),
  montant    numeric not null check (montant >= 0),
  note       text,
  cree_par   uuid default auth.uid(),
  cree_le    timestamptz not null default now()
);
comment on table public.couts_fixes is 'fichier: marges.sql — coûts fixes du mois (loyer, salaires…) par pays. Confidentiel (voir_marges).';
create unique index if not exists couts_fixes_un_par_mois on public.couts_fixes (tenant_id, pays_id, mois);

create table if not exists public.couts_produits (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  produit_id    uuid not null references public.produits(id) on delete cascade,
  cout_unite    numeric not null check (cout_unite >= 0),
  valide_depuis date not null default current_date,
  cree_par      uuid default auth.uid(),
  cree_le       timestamptz not null default now()
);
comment on table public.couts_produits is 'fichier: marges.sql — coût d''achat par unité d''un produit, à partir d''une date. Confidentiel (voir_marges).';
create unique index if not exists couts_produits_un_par_jour on public.couts_produits (tenant_id, produit_id, valide_depuis);

-- Le pays / le produit doit être de la même entreprise que la ligne.
create or replace function public.couts_meme_entreprise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'couts_produits' then
    if not exists (select 1 from public.produits p where p.id = new.produit_id and p.tenant_id = new.tenant_id) then
      raise exception 'Ce produit n''est pas de cette entreprise.' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.pays p where p.id = new.pays_id and p.tenant_id = new.tenant_id) then
    raise exception 'Ce pays n''est pas de cette entreprise.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.couts_meme_entreprise() from public, anon, authenticated;
comment on function public.couts_meme_entreprise() is 'fichier: marges.sql';

do $$
declare t text; p record;
begin
  foreach t in array array['couts_fgmed', 'couts_fixes', 'couts_produits'] loop
    execute format('drop trigger if exists trg_%1$s_entreprise on public.%1$I', t);
    execute format('create trigger trg_%1$s_entreprise before insert or update on public.%1$I
                      for each row execute function public.couts_meme_entreprise()', t);
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %1$s_marges on public.%1$I for all to authenticated
                      using (public.is_super_admin()
                             or (tenant_id = public.get_my_tenant_id() and public.a_la_permission(''voir_marges'')))
                      with check (public.is_super_admin()
                             or (tenant_id = public.get_my_tenant_id() and public.a_la_permission(''voir_marges'')))', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- §5 Les calculs -----------------------------------------------------------------------
-- Qui calcule : super admin, ou l'entreprise demandée est la sienne ET voir_marges.
create or replace function public.peut_voir_marges(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (public.is_super_admin()
          or (p_tenant is not distinct from public.get_my_tenant_id() and public.a_la_permission('voir_marges')))
$$;
revoke all on function public.peut_voir_marges(uuid) from public, anon, authenticated;
comment on function public.peut_voir_marges(uuid) is 'fichier: marges.sql';

-- Les commandes LIVRÉES de la période, avec l'encaissé et les frais FGMED de chacune
-- (copiés du relevé, sinon le tarif du jour de livraison). Interne.
create or replace function public.marges_livrees(p_tenant uuid, p_debut date, p_fin date)
returns table (commande_id uuid, pays_id uuid, vendeur_id uuid, produit_id uuid, produit_texte text,
               jour date, unites integer, encaisse numeric, frais numeric)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.pays_id, c.vendeur_id, c.produit_id, c.produit, x.jour, x.q,
         coalesce((select sum(p.montant) from public.paiements p where p.commande_id = c.id), c.prix, 0),
         coalesce(rc.frais_commande + rc.frais_livraison + rc.frais_upsell,
                  t.frais_commande + t.frais_livraison + t.frais_upsell_unite * (x.q - 1))
    from public.livraisons l
    join public.commandes c on c.id = l.commande_id
    cross join lateral (select coalesce(l.date_livraison, l.statut_le, l.created_at)::date as jour,
                               greatest(coalesce(c.quantite, 1), 1) as q) x
    left join public.reglements_commandes rc on rc.commande_id = c.id
    left join lateral public.tarif_applicable(c.tenant_id, c.pays_id, c.vendeur_id, x.jour) t on true
   where l.tenant_id = p_tenant and c.tenant_id = p_tenant and l.statut = 'livre'
     and x.jour between p_debut and p_fin
$$;
revoke all on function public.marges_livrees(uuid, date, date) from public, anon, authenticated;
comment on function public.marges_livrees(uuid, date, date) is 'fichier: marges.sql';

-- Les coûts FGMED d'un pays ce jour-là (rien = aucune ligne).
create or replace function public.cout_fgmed_applicable(p_tenant uuid, p_pays uuid, p_jour date)
returns table (cout_livraison numeric, cout_retour numeric, cout_confirmation numeric)
language sql
stable
security definer
set search_path = public
as $$
  select k.cout_livraison, k.cout_retour, k.cout_confirmation
    from public.couts_fgmed k
   where k.tenant_id = p_tenant and k.pays_id = p_pays and k.valide_depuis <= p_jour
   order by k.valide_depuis desc
   limit 1
$$;
revoke all on function public.cout_fgmed_applicable(uuid, uuid, date) from public, anon, authenticated;
comment on function public.cout_fgmed_applicable(uuid, uuid, date) is 'fichier: marges.sql';

-- A · une ligne par (pays, vendeur). vendeur_id vide + non_reparti = les coûts fixes
-- d'un pays sans livraison dans la période.
create or replace function public.marge_fgmed(p_tenant uuid, p_debut date, p_fin date)
returns table (pays_id uuid, pays_nom text, devise text, vendeur_id uuid, non_reparti boolean,
               nb_livrees integer, nb_retours integer, nb_confirmees integer,
               encaisse numeric, revenus numeric, nb_sans_frais integer,
               cout_livraisons numeric, cout_retours numeric, cout_confirmations numeric, cout_fixes numeric,
               nb_sans_cout integer, marge numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.peut_voir_marges(p_tenant) then
    raise exception 'Les marges sont réservées à l''admin de l''entreprise.' using errcode = '42501';
  end if;
  if p_debut is null or p_fin is null or p_fin < p_debut then
    raise exception 'Choisissez une période (la fin après le début).';
  end if;
  if p_fin - p_debut > 400 then
    raise exception 'Période trop longue : 400 jours au plus.';
  end if;

  return query
  with ev as (
    -- livrées
    select m.pays_id, m.vendeur_id, 'livre'::text as quoi, m.encaisse, m.frais,
           (select k.cout_livraison from public.cout_fgmed_applicable(p_tenant, m.pays_id, m.jour) k) as cout
      from public.marges_livrees(p_tenant, p_debut, p_fin) m
    union all
    -- retours (le jour du passage en retour)
    select c.pays_id, c.vendeur_id, 'retour', 0, 0,
           (select k.cout_retour from public.cout_fgmed_applicable(p_tenant, c.pays_id, x.jour) k)
      from public.livraisons l
      join public.commandes c on c.id = l.commande_id
      cross join lateral (select coalesce(l.statut_le, l.created_at)::date as jour) x
     where l.tenant_id = p_tenant and c.tenant_id = p_tenant and l.statut = 'retour'
       and x.jour between p_debut and p_fin
    union all
    -- leads confirmés : le jour de leur PREMIÈRE confirmation
    select c.pays_id, c.vendeur_id, 'confirme', 0, 0,
           (select k.cout_confirmation from public.cout_fgmed_applicable(p_tenant, c.pays_id, f.jour) k)
      from (select h.commande_id, min(h.cree_le)::date as jour
              from public.historique_statuts h
             where h.tenant_id = p_tenant and h.commande_id is not null
               and h.statut in (select s.nom from public.statuts s where s.tenant_id = p_tenant and s.declenche_assignation)
             group by h.commande_id) f
      join public.commandes c on c.id = f.commande_id
     where f.jour between p_debut and p_fin
  ),
  par as (
    select e.pays_id, e.vendeur_id,
           count(*) filter (where e.quoi = 'livre')::integer    as nb_l,
           count(*) filter (where e.quoi = 'retour')::integer   as nb_r,
           count(*) filter (where e.quoi = 'confirme')::integer as nb_c,
           coalesce(sum(e.encaisse) filter (where e.quoi = 'livre'), 0) as enc,
           coalesce(sum(e.frais) filter (where e.quoi = 'livre'), 0)    as rev,
           count(*) filter (where e.quoi = 'livre' and e.frais is null)::integer as sans_frais,
           coalesce(sum(e.cout) filter (where e.quoi = 'livre'), 0)    as c_l,
           coalesce(sum(e.cout) filter (where e.quoi = 'retour'), 0)   as c_r,
           coalesce(sum(e.cout) filter (where e.quoi = 'confirme'), 0) as c_c,
           count(*) filter (where e.cout is null)::integer as sans_cout
      from ev e
     group by e.pays_id, e.vendeur_id
  ),
  fixes as (
    -- chaque mois touché par la période, au prorata de ses jours dans la période
    select f.pays_id,
           sum(f.montant * (least(p_fin, (f.mois + interval '1 month - 1 day')::date) - greatest(p_debut, f.mois) + 1)
                 / extract(day from (f.mois + interval '1 month - 1 day'))) as montant
      from public.couts_fixes f
     where f.tenant_id = p_tenant
       and f.mois <= p_fin and (f.mois + interval '1 month - 1 day')::date >= p_debut
     group by f.pays_id
  ),
  livres_pays as (
    select pa.pays_id, sum(pa.nb_l) as nb from par pa group by pa.pays_id
  ),
  lignes as (
    select pa.pays_id, pa.vendeur_id, false as nr, pa.nb_l, pa.nb_r, pa.nb_c, pa.enc, pa.rev, pa.sans_frais,
           pa.c_l, pa.c_r, pa.c_c,
           case when coalesce(lp.nb, 0) > 0 then round(coalesce(fx.montant, 0) * pa.nb_l / lp.nb, 2) else 0 end as c_f,
           pa.sans_cout
      from par pa
      left join livres_pays lp on lp.pays_id = pa.pays_id
      left join fixes fx on fx.pays_id = pa.pays_id
    union all
    -- coûts fixes d'un pays sans aucune livraison dans la période
    select fx.pays_id, null::uuid, true, 0, 0, 0, 0, 0, 0, 0, 0, 0, round(fx.montant, 2), 0
      from fixes fx
      left join livres_pays lp on lp.pays_id = fx.pays_id
     where coalesce(lp.nb, 0) = 0 and fx.montant > 0
  )
  select li.pays_id, pa.nom, pa.devise, li.vendeur_id, li.nr,
         li.nb_l, li.nb_r, li.nb_c, li.enc, li.rev, li.sans_frais,
         li.c_l, li.c_r, li.c_c, li.c_f, li.sans_cout,
         li.rev - li.c_l - li.c_r - li.c_c - li.c_f
    from lignes li
    left join public.pays pa on pa.id = li.pays_id
   order by pa.nom nulls last, li.nr, li.vendeur_id nulls last;
end;
$$;
revoke all on function public.marge_fgmed(uuid, date, date) from public, anon;
grant execute on function public.marge_fgmed(uuid, date, date) to authenticated, service_role;
comment on function public.marge_fgmed(uuid, date, date) is 'fichier: marges.sql';

-- B · une ligne par (produit, pays). produit_id vide = commandes sans produit relié.
create or replace function public.marge_produits(p_tenant uuid, p_debut date, p_fin date)
returns table (produit_id uuid, produit_nom text, produit_code text, pays_id uuid, pays_nom text, devise text,
               nb_livrees integer, unites integer, encaisse numeric, frais_fgmed numeric,
               cout_achat numeric, nb_sans_cout integer, marge numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.peut_voir_marges(p_tenant) then
    raise exception 'Les marges sont réservées à l''admin de l''entreprise.' using errcode = '42501';
  end if;
  if p_debut is null or p_fin is null or p_fin < p_debut then
    raise exception 'Choisissez une période (la fin après le début).';
  end if;
  if p_fin - p_debut > 400 then
    raise exception 'Période trop longue : 400 jours au plus.';
  end if;

  return query
  with l as (
    select m.*,
           (select k.cout_unite from public.couts_produits k
             where k.tenant_id = p_tenant and k.produit_id = m.produit_id and k.valide_depuis <= m.jour
             order by k.valide_depuis desc limit 1) as cu
      from public.marges_livrees(p_tenant, p_debut, p_fin) m
  ),
  g as (
    select l.produit_id, l.pays_id,
           count(*)::integer as nb, sum(l.unites)::integer as u,
           sum(l.encaisse) as enc, coalesce(sum(l.frais), 0) as fr,
           coalesce(sum(l.unites * l.cu), 0) as ca,
           count(*) filter (where l.cu is null)::integer as sans,
           max(l.produit_texte) as texte
      from l
     group by l.produit_id, l.pays_id
  )
  select g.produit_id, coalesce(pr.product, 'Produit non relié : ' || coalesce(g.texte, '?')), pr.code,
         g.pays_id, pa.nom, pa.devise,
         g.nb, g.u, g.enc, g.fr, g.ca, g.sans,
         case when g.sans = 0 then g.enc - g.ca - g.fr end
    from g
    left join public.produits pr on pr.id = g.produit_id
    left join public.pays pa on pa.id = g.pays_id
   order by pa.nom nulls last, g.enc desc;
end;
$$;
revoke all on function public.marge_produits(uuid, date, date) from public, anon;
grant execute on function public.marge_produits(uuid, date, date) to authenticated, service_role;
comment on function public.marge_produits(uuid, date, date) is 'fichier: marges.sql';

-- §6 Contrôles -------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['couts_fgmed', 'couts_fixes', 'couts_produits'] loop
    if has_table_privilege('anon', 'public.' || t, 'select')
       or not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'marges.sql : % est lisible sans contrôle. Rien n''est installé.', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.marges_livrees(uuid, date, date)', 'execute') then
    raise exception 'marges.sql : le calcul interne est ouvert au navigateur. Rien n''est installé.';
  end if;
end $$;

-- §7 Répétition (annulée) dans l'entreprise de test ------------------------------------
--   l'admin de test saisit des coûts et calcule A et B ; un manager est refusé
--   (calcul et lecture des coûts). Tout est annulé.
do $$
declare
  c_test constant uuid := '17144700-2b95-43fa-9849-9e7a8f35104e';
  v_admin uuid; v_mgr uuid; v_pays uuid; n integer; v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  if not exists (select 1 from public.tenants where id = c_test) then
    raise notice 'marges.sql : pas d''entreprise de test — répétition sautée.'; return;
  end if;
  select u.user_id into v_admin from public.user_roles u join public.roles ro on ro.id = u.role_id
   where u.tenant_id = c_test and ro.nom = 'admin' and ro.tenant_id is null limit 1;
  select u.user_id into v_mgr from public.user_roles u join public.roles ro on ro.id = u.role_id
   where u.tenant_id = c_test and ro.nom = 'manager' and ro.tenant_id is null limit 1;
  select id into v_pays from public.pays where tenant_id = c_test order by nom limit 1;
  if v_admin is null or v_mgr is null or v_pays is null then
    raise notice 'marges.sql : l''entreprise de test n''a pas d''admin, de manager ou de pays — répétition sautée.'; return;
  end if;

  begin
    v_etape := 'l''admin saisit des coûts';
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.couts_fgmed (tenant_id, pays_id, cout_livraison, cout_retour, cout_confirmation, valide_depuis)
    values (c_test, v_pays, 4000, 2000, 1000, date '2000-01-01');
    insert into public.couts_fixes (tenant_id, pays_id, mois, montant) values (c_test, v_pays, date '2000-01-01', 1);

    v_etape := 'l''admin calcule A et B';
    select count(*) into n from public.marge_fgmed(c_test, current_date - 30, current_date);
    select count(*) into n from public.marge_produits(c_test, current_date - 30, current_date);

    v_etape := 'un manager est refusé';
    perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
    v_refus := false;
    begin perform * from public.marge_fgmed(c_test, current_date - 30, current_date);
    exception when insufficient_privilege then v_refus := true; end;
    if not v_refus then raise exception 'un manager calcule la marge'; end if;
    select count(*) into n from public.couts_fgmed;
    if n <> 0 then raise exception 'un manager lit les coûts (%)', n; end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    if v_msg <> 'REPETITION_OK' then
      raise exception 'marges.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'marges.sql : coûts et marges réservés à voir_marges (admin, super admin) ; A et B calculés par la base. Répétition annulée.';
end $$;

commit;

-- Ce qui est en place
select (select string_agg(r.nom, ', ' order by r.nom) from public.role_permissions rp join public.roles r on r.id = rp.role_id
         where rp.permission_code = 'voir_marges') as voir_marges,
       (select count(*) from pg_trigger where tgname = 'trg_ab_livraison_statut_le') as trigger_statut_le;
