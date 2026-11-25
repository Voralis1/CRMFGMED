-- =============================================================================
-- FRAIS VENDEURS : LES FRAIS DE CHAQUE LEAD, CALCULÉS PAR LE CRM — 05/11/2026
-- NE MODIFIE AUCUNE DONNÉE EXISTANTE. Ajoute une table, des colonnes, 2 fonctions.
-- À lancer AVANT reglement_atomique.sql (version du 05/11, qui s'en sert).
-- =============================================================================
--
-- SA DÉCISION (05/11, ses 3 relevés d'Angola en exemple) :
--   pour chaque lead LIVRÉ dont l'argent est au bureau :
--     frais commande (« cosmétique ») + frais de livraison + frais upsell
--     par unité EN PLUS × (quantité − 1)
--     Angola : 1 000 + 12 000 + 1 500 × (unités − 1)
--     net du lead = total − ces frais.
--   pour le relevé : total des leads − tous ces frais − CHARGES (saisies à la
--   main, avec une note : elles changent à chaque relevé) = À PAYER.
--   Retours / annulations : jamais dans un relevé → aucun frais.
--
-- CE QUE FAIT LE FICHIER :
--   §1 table tarifs_vendeurs : par PAYS (vendeur vide = valeur du pays) et,
--      au choix, par VENDEUR (remplace celle du pays), avec une date de
--      début (« valide depuis ») — l'historique se garde, rien n'est écrasé.
--      Lecture : manager, admin, ceo, super admin. Écriture : ADMIN et super
--      admin seulement (sa décision). Garde : le pays et le vendeur sont de
--      l'entreprise, le vendeur est un vendeur.
--   §2 tarif_applicable(entreprise, pays, vendeur, jour) : la règle — la
--      valeur du vendeur valable ce jour-là, sinon celle du pays. Aucun
--      montant écrit dans le code.
--   §3 colonnes : reglements_commandes (quantité, total, frais commande,
--      livraison, upsell, net — COPIÉS à l'établissement, figés ensuite) ;
--      reglements (frais_upsell, frais_divers_note : la note des charges).
--   §4 fixer_charges_releve(relevé, montant, note) : les CHARGES d'un relevé
--      NON payé, note obligatoire, « à payer » recalculé par la base.
--      manager / admin (gerer_reglements) de l'entreprise, ou super admin.
--   §5 vérification.
--
-- RETOUR ARRIÈRE : frais_vendeurs_retour.sql (copie sur le Bureau) — APRÈS
-- avoir remis reglement_atomique.sql en version du 03/11 (voir ce fichier).
-- =============================================================================

begin;

-- §1 La table des frais -------------------------------------------------------------
create table if not exists public.tarifs_vendeurs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  pays_id            uuid not null references public.pays(id) on delete cascade,
  vendeur_id         uuid references auth.users(id) on delete cascade,   -- vide = valeur du pays
  frais_commande     numeric not null default 0 check (frais_commande >= 0),
  frais_livraison    numeric not null default 0 check (frais_livraison >= 0),
  frais_upsell_unite numeric not null default 0 check (frais_upsell_unite >= 0),
  valide_depuis      date not null default current_date,
  cree_par           uuid default auth.uid(),
  cree_le            timestamptz not null default now()
);
comment on table public.tarifs_vendeurs is
  'fichier: frais_vendeurs.sql — frais par lead livré : par pays (vendeur vide) ou par vendeur, à partir d''une date.';
create unique index if not exists tarifs_vendeurs_un_par_jour
  on public.tarifs_vendeurs (tenant_id, pays_id, coalesce(vendeur_id, '00000000-0000-0000-0000-000000000000'::uuid), valide_depuis);

create or replace function public.tarifs_vendeurs_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.pays p where p.id = new.pays_id and p.tenant_id = new.tenant_id) then
    raise exception 'Frais vendeurs : ce pays n''est pas de l''entreprise.';
  end if;
  if new.vendeur_id is not null and not exists (
       select 1 from public.user_roles u
        where u.user_id = new.vendeur_id and u.tenant_id = new.tenant_id and lower(u.role) = 'seller') then
    raise exception 'Frais vendeurs : ce compte n''est pas un vendeur de l''entreprise.';
  end if;
  return new;
end;
$$;
revoke all on function public.tarifs_vendeurs_garde() from public, anon, authenticated;
drop trigger if exists trg_tarifs_vendeurs_garde on public.tarifs_vendeurs;
create trigger trg_tarifs_vendeurs_garde
  before insert or update on public.tarifs_vendeurs
  for each row execute function public.tarifs_vendeurs_garde();

alter table public.tarifs_vendeurs enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'tarifs_vendeurs'
  loop execute format('drop policy %I on public.tarifs_vendeurs', p.policyname); end loop;
end $$;
create policy tarifs_vendeurs_lecture on public.tarifs_vendeurs for select to authenticated
  using (public.is_super_admin() or (tenant_id = public.get_my_tenant_id() and public.est_responsable()));
create policy tarifs_vendeurs_ajout on public.tarifs_vendeurs for insert to authenticated
  with check (public.is_super_admin() or (tenant_id = public.get_my_tenant_id() and lower(coalesce(public.mon_role(), '')) = 'admin'));
create policy tarifs_vendeurs_modif on public.tarifs_vendeurs for update to authenticated
  using (public.is_super_admin() or (tenant_id = public.get_my_tenant_id() and lower(coalesce(public.mon_role(), '')) = 'admin'))
  with check (public.is_super_admin() or (tenant_id = public.get_my_tenant_id() and lower(coalesce(public.mon_role(), '')) = 'admin'));
create policy tarifs_vendeurs_suppression on public.tarifs_vendeurs for delete to authenticated
  using (public.is_super_admin() or (tenant_id = public.get_my_tenant_id() and lower(coalesce(public.mon_role(), '')) = 'admin'));
revoke all on public.tarifs_vendeurs from anon;
grant select, insert, update, delete on public.tarifs_vendeurs to authenticated;
grant all on public.tarifs_vendeurs to service_role;

-- §2 La règle : quels frais pour ce lead ------------------------------------------------
create or replace function public.tarif_applicable(p_tenant uuid, p_pays uuid, p_vendeur uuid, p_jour date)
returns table (frais_commande numeric, frais_livraison numeric, frais_upsell_unite numeric)
language sql
stable
security definer
set search_path = public
as $$
  select t.frais_commande, t.frais_livraison, t.frais_upsell_unite
    from public.tarifs_vendeurs t
   where t.tenant_id = p_tenant and t.pays_id = p_pays
     and (t.vendeur_id = p_vendeur or t.vendeur_id is null)
     and t.valide_depuis <= coalesce(p_jour, current_date)
   order by (t.vendeur_id is not null) desc, t.valide_depuis desc
   limit 1;
$$;
revoke all on function public.tarif_applicable(uuid, uuid, uuid, date) from public, anon, authenticated;
comment on function public.tarif_applicable(uuid, uuid, uuid, date) is 'fichier: frais_vendeurs.sql';

-- §3 Les colonnes -------------------------------------------------------------------------
alter table public.reglements_commandes add column if not exists quantite        integer;
alter table public.reglements_commandes add column if not exists total_commande  numeric;
alter table public.reglements_commandes add column if not exists frais_commande  numeric not null default 0;
alter table public.reglements_commandes add column if not exists frais_livraison numeric not null default 0;
alter table public.reglements_commandes add column if not exists frais_upsell    numeric not null default 0;
alter table public.reglements_commandes add column if not exists net             numeric;
alter table public.reglements add column if not exists frais_upsell      numeric not null default 0;
alter table public.reglements add column if not exists frais_divers_note text;

-- §4 Les charges d'un relevé (à la main, avant paiement) -------------------------------------
-- GARDE (09/11) : fixer_charges_releve est reprise par retenues_releve.sql (les
-- charges sont devenues des ajustements). Marquée par lui → gardée telle quelle.
do $garde$
declare
  v_marque text := obj_description(to_regprocedure('public.fixer_charges_releve(uuid, numeric, text)'), 'pg_proc');
begin
  if v_marque in ('fichier: retenues_releve.sql') then
    raise notice 'frais_vendeurs.sql : fixer_charges_releve gardée (%, plus récent). Pas réécrite.', v_marque;
    return;
  end if;
  execute $def$
create or replace function public.fixer_charges_releve(p_reglement uuid, p_montant numeric, p_note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare r public.reglements%rowtype; v_net numeric;
begin
  select * into r from public.reglements where id = p_reglement for update;
  if not found then
    raise exception 'Relevé introuvable.';
  end if;
  if not (public.is_super_admin()
          or (r.tenant_id = public.get_my_tenant_id() and public.a_la_permission('gerer_reglements'))) then
    raise exception 'Votre rôle ne permet pas de modifier un relevé.' using errcode = '42501';
  end if;
  if r.statut = 'paye' then
    raise exception 'Ce relevé est déjà payé : ses charges ne peuvent plus changer.';
  end if;
  if p_montant is null or p_montant < 0 then
    raise exception 'Montant des charges invalide.';
  end if;
  if p_montant > 0 and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Écrivez à quoi correspondent ces charges (note obligatoire).';
  end if;
  v_net := r.total_ventes - r.frais_confirmation - r.frais_livraison - r.frais_upsell - r.frais_service - p_montant;
  perform set_config('crm.reglement_calcul', 'oui', true);
  update public.reglements
     set frais_divers = p_montant,
         frais_divers_note = nullif(btrim(coalesce(p_note, '')), ''),
         net_a_payer = v_net
   where id = r.id;
  perform set_config('crm.reglement_calcul', '', true);
  return v_net;
end;
$$
$def$;
  execute $def$ revoke all on function public.fixer_charges_releve(uuid, numeric, text) from public, anon $def$;
  execute $def$ grant execute on function public.fixer_charges_releve(uuid, numeric, text) to authenticated, service_role $def$;
  comment on function public.fixer_charges_releve(uuid, numeric, text) is 'fichier: frais_vendeurs.sql';
end $garde$;

-- §5 Vérification -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.tarif_applicable(uuid,uuid,uuid,date)', 'execute') then
    raise exception 'frais_vendeurs.sql : tarif_applicable est appelable par un compte. Rien n''est installé.';
  end if;
  if exists (select 1 from pg_policies where tablename = 'tarifs_vendeurs' and cmd <> 'SELECT'
              and coalesce(qual, '') || coalesce(with_check, '') not ilike '%admin%') then
    raise exception 'frais_vendeurs.sql : une politique d''écriture ne limite pas à l''admin. Rien n''est installé.';
  end if;
  raise notice 'frais_vendeurs.sql : table des frais (admin), règle par pays / vendeur / date, colonnes du relevé, charges à la main. Aucune donnée modifiée.';
end $$;

commit;
