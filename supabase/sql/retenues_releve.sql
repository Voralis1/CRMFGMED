-- =============================================================================
-- LE BAS DU RELEVÉ : CRÉDIT D'EXPÉDITION, AJUSTEMENTS, FRAIS DE TRANSFERT — 09/11/2026
-- NE CHANGE AUCUN MONTANT D'UN RELEVÉ EXISTANT.
-- À lancer APRÈS frais_vendeurs.sql, PUIS relancer reglement_atomique.sql.
-- =============================================================================
--
-- SES DÉCISIONS (09/11, d'après CRM_seller_payment_rules.docx §1 §4 §5) :
--   · CRÉDIT D'EXPÉDITION : saisi À LA MAIN sur le relevé, UN par relevé (les
--     relevés sont hebdomadaires) : date de l'expédition, poids (kg), prix au
--     kg ET montant — TOUS tapés, tous obligatoires, le montant n'est PAS
--     calculé (sa décision 09/11 soir) — + note facultative. Tout est montré au
--     vendeur (le document : « date, weight, price per kg, amount »). Tout
--     vide = 0.
--   · AJUSTEMENTS : des lignes — Pénalité (retenue), Remboursement (rendu au
--     vendeur), Correction (l'un ou l'autre, au choix), Autre (retenue). Note
--     obligatoire ; qui et quand sont enregistrés. Les « Charges » d'avant
--     deviennent une ligne « Autre » (même montant, même note).
--   · FRAIS DE TRANSFERT : un % saisi par l'admin dans Paramètres → Frais
--     vendeurs, sur chaque ligne de frais (pays / vendeur / date), 0 = aucun.
--     COPIÉ sur le relevé à son établissement (au jour de l'établissement).
--   · Tout se change seulement AVANT « payé » ; manager / admin
--     (gerer_reglements) de l'entreprise, ou super admin. Le vendeur lit.
--
-- LE CALCUL (calcul_net_releve, une seule copie) :
--   base       = total des ventes − frais commande − livraison − upsell − service
--   sous-total = base − crédit d'expédition − (retenues − rendus)
--   transfert  = sous-total × % (arrondi au centime ; 0 si le sous-total est ≤ 0)
--   à payer    = sous-total − transfert
--   Exemple du document : 79 000, crédit 10 000, 1,5 % → 1 035 → 67 965.
--
-- CE QUE FAIT LE FICHIER :
--   §1 colonnes : tarifs_vendeurs.frais_transfert_pct ; reglements.credit_
--      expedition (+ note, poids, prix au kg), frais_transfert_pct,
--      frais_transfert. frais_divers = (retenues − rendus) des ajustements.
--   §2 table reglements_ajustements (lecture = qui voit le relevé ; aucune
--      écriture directe : seulement par les fonctions).
--   §3 calcul_net_releve, transfert_applicable, recalculer_releve (internes).
--   §4 les portes : fixer_credit_expedition, ajouter_ajustement,
--      retirer_ajustement. fixer_charges_releve (frais_vendeurs.sql) est
--      reprise : elle refuse et dit de recharger la page (l'ancien écran).
--   §5 les charges existantes → une ligne « Autre » chacune (relevés payés
--      compris : la ligne est l'historique, le montant ne bouge pas).
--   §6 répétition : le calcul sur les exemples (un fichier fautif s'arrête là).
--
-- RETOUR ARRIÈRE : reglement_atomique_retour_09_11.sql PUIS
-- retenues_releve_retour.sql (copies sur le Bureau).
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.tarif_applicable(uuid, uuid, uuid, date)') is null then
    raise exception 'retenues_releve.sql : lancez d''abord frais_vendeurs.sql. Rien n''est installé.';
  end if;
  if to_regprocedure('public.reglement_visible(uuid)') is null then
    raise exception 'retenues_releve.sql : reglement_visible(uuid) absente. Rien n''est installé.';
  end if;
end $$;

-- §1 Les colonnes -------------------------------------------------------------------
alter table public.tarifs_vendeurs add column if not exists frais_transfert_pct numeric not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tarifs_vendeurs_transfert_pct_ok') then
    alter table public.tarifs_vendeurs add constraint tarifs_vendeurs_transfert_pct_ok
      check (frais_transfert_pct >= 0 and frais_transfert_pct <= 100);
  end if;
end $$;
alter table public.reglements add column if not exists credit_expedition         numeric not null default 0;
alter table public.reglements add column if not exists credit_expedition_note    text;
alter table public.reglements add column if not exists credit_expedition_poids   numeric;
alter table public.reglements add column if not exists credit_expedition_prix_kg numeric;
alter table public.reglements add column if not exists credit_expedition_date    date;
alter table public.reglements add column if not exists frais_transfert_pct       numeric not null default 0;
alter table public.reglements add column if not exists frais_transfert           numeric not null default 0;

-- §2 Les ajustements ----------------------------------------------------------------
create table if not exists public.reglements_ajustements (
  id           uuid primary key default gen_random_uuid(),
  reglement_id uuid not null references public.reglements(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  type         text not null check (type in ('penalite', 'remboursement', 'correction', 'autre')),
  montant      numeric not null check (montant > 0),
  en_plus      boolean not null default false,   -- vrai = rendu au vendeur, faux = retenu
  note         text not null check (btrim(note) <> ''),
  cree_par     uuid default auth.uid(),
  cree_le      timestamptz not null default now()
);
comment on table public.reglements_ajustements is
  'fichier: retenues_releve.sql — pénalités, remboursements, corrections d''un relevé ; écrits par ajouter_ajustement / retirer_ajustement.';
create index if not exists reglements_ajustements_reglement on public.reglements_ajustements (reglement_id);

alter table public.reglements_ajustements enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'reglements_ajustements'
  loop execute format('drop policy %I on public.reglements_ajustements', p.policyname); end loop;
end $$;
create policy reglements_ajustements_lecture on public.reglements_ajustements for select to authenticated
  using (public.reglement_visible(reglement_id));
revoke all on public.reglements_ajustements from anon, authenticated;
grant select on public.reglements_ajustements to authenticated;
grant all on public.reglements_ajustements to service_role;

-- §3 Le calcul ---------------------------------------------------------------------
create or replace function public.calcul_net_releve(p_base numeric, p_credit numeric, p_ajust numeric, p_pct numeric)
returns table (frais_transfert numeric, net numeric)
language sql
immutable
set search_path = public
as $$
  select t.tr, s.st - t.tr
    from (select coalesce(p_base, 0) - coalesce(p_credit, 0) - coalesce(p_ajust, 0) as st) s
    cross join lateral (select case when s.st > 0 then round(s.st * coalesce(p_pct, 0) / 100, 2) else 0 end as tr) t;
$$;
revoke all on function public.calcul_net_releve(numeric, numeric, numeric, numeric) from public, anon, authenticated;
comment on function public.calcul_net_releve(numeric, numeric, numeric, numeric) is 'fichier: retenues_releve.sql';

-- Le % du vendeur ce jour-là, sinon celui du pays ; 0 si rien.
create or replace function public.transfert_applicable(p_tenant uuid, p_pays uuid, p_vendeur uuid, p_jour date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select t.frais_transfert_pct
      from public.tarifs_vendeurs t
     where t.tenant_id = p_tenant and t.pays_id = p_pays
       and (t.vendeur_id = p_vendeur or t.vendeur_id is null)
       and t.valide_depuis <= coalesce(p_jour, current_date)
     order by (t.vendeur_id is not null) desc, t.valide_depuis desc
     limit 1), 0);
$$;
revoke all on function public.transfert_applicable(uuid, uuid, uuid, date) from public, anon, authenticated;
comment on function public.transfert_applicable(uuid, uuid, uuid, date) is 'fichier: retenues_releve.sql';

-- Recalcule l'en-tête d'un relevé depuis ses lignes, son crédit, ses
-- ajustements et son % copié. Interne : appelée par les portes (qui vérifient
-- les droits et « pas payé ») et par etablir_releve.
create or replace function public.recalculer_releve(p_reglement uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare r public.reglements%rowtype; v_ajust numeric; v_tr numeric; v_net numeric;
begin
  select * into r from public.reglements where id = p_reglement;
  if not found then
    raise exception 'Relevé introuvable.';
  end if;
  select coalesce(sum(case when a.en_plus then -a.montant else a.montant end), 0) into v_ajust
    from public.reglements_ajustements a where a.reglement_id = r.id;
  select c.frais_transfert, c.net into v_tr, v_net
    from public.calcul_net_releve(
           r.total_ventes - r.frais_confirmation - r.frais_livraison - r.frais_upsell - r.frais_service,
           r.credit_expedition, v_ajust, r.frais_transfert_pct) c;
  perform set_config('crm.reglement_calcul', 'oui', true);
  update public.reglements
     set frais_divers = v_ajust, frais_transfert = v_tr, net_a_payer = v_net
   where id = r.id;
  perform set_config('crm.reglement_calcul', '', true);
  return v_net;
end;
$$;
revoke all on function public.recalculer_releve(uuid) from public, anon, authenticated;
comment on function public.recalculer_releve(uuid) is 'fichier: retenues_releve.sql';

-- §4 Les portes ------------------------------------------------------------------------
-- Un relevé de l'entreprise, non payé, que l'appelant peut modifier ; sinon refus.
create or replace function public.releve_modifiable(p_reglement uuid)
returns public.reglements
language plpgsql
security definer
set search_path = public
as $$
declare r public.reglements%rowtype;
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
    raise exception 'Ce relevé est déjà payé : il ne peut plus changer.';
  end if;
  return r;
end;
$$;
revoke all on function public.releve_modifiable(uuid) from public, anon, authenticated;
comment on function public.releve_modifiable(uuid) is 'fichier: retenues_releve.sql';

-- Le crédit d'expédition : date + kg + prix au kg + montant, tous tapés.
-- Tout vide = aucun crédit (0). Les signatures d'avant (09/11 matin et
-- après-midi) sont retirées.
drop function if exists public.fixer_credit_expedition(uuid, numeric, text, numeric, numeric);
drop function if exists public.fixer_credit_expedition(uuid, date, numeric, numeric, text);
create or replace function public.fixer_credit_expedition(
  p_reglement uuid, p_date date, p_poids numeric, p_prix_kg numeric, p_montant numeric, p_note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare r public.reglements%rowtype; v_vide boolean; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  r := public.releve_modifiable(p_reglement);
  v_vide := p_date is null and p_poids is null and p_prix_kg is null and p_montant is null;
  if not v_vide then
    if p_date is null or p_poids is null or p_prix_kg is null or p_montant is null then
      raise exception 'Crédit d''expédition : donnez la date, le poids, le prix au kg ET le montant.';
    end if;
    if p_poids <= 0 or p_prix_kg < 0 or p_montant < 0 then
      raise exception 'Crédit d''expédition : poids, prix au kg ou montant invalide.';
    end if;
  end if;
  perform set_config('crm.reglement_calcul', 'oui', true);
  update public.reglements
     set credit_expedition = case when v_vide then 0 else p_montant end,
         credit_expedition_date = p_date,
         credit_expedition_poids = p_poids,
         credit_expedition_prix_kg = p_prix_kg,
         credit_expedition_note = case when v_vide then null else v_note end
   where id = r.id;
  perform set_config('crm.reglement_calcul', '', true);
  return public.recalculer_releve(r.id);
end;
$$;
revoke all on function public.fixer_credit_expedition(uuid, date, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.fixer_credit_expedition(uuid, date, numeric, numeric, numeric, text) to authenticated, service_role;
comment on function public.fixer_credit_expedition(uuid, date, numeric, numeric, numeric, text) is 'fichier: retenues_releve.sql';

-- Un ajustement. Le sens suit le type ; seule la correction le laisse choisir.
create or replace function public.ajouter_ajustement(
  p_reglement uuid, p_type text, p_montant numeric, p_en_plus boolean, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare r public.reglements%rowtype; v_plus boolean; v_id uuid;
begin
  r := public.releve_modifiable(p_reglement);
  if p_type is null or p_type not in ('penalite', 'remboursement', 'correction', 'autre') then
    raise exception 'Type d''ajustement inconnu : %.', coalesce(p_type, 'vide');
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'Le montant doit être plus grand que 0.';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Écrivez la raison de cet ajustement (note obligatoire).';
  end if;
  v_plus := case p_type when 'remboursement' then true
                        when 'correction' then p_en_plus
                        else false end;
  if v_plus is null then
    raise exception 'Correction : choisissez si elle est retenue au vendeur ou rendue au vendeur.';
  end if;
  insert into public.reglements_ajustements (reglement_id, tenant_id, type, montant, en_plus, note)
  values (r.id, r.tenant_id, p_type, p_montant, v_plus, btrim(p_note))
  returning id into v_id;
  perform public.recalculer_releve(r.id);
  return v_id;
end;
$$;
revoke all on function public.ajouter_ajustement(uuid, text, numeric, boolean, text) from public, anon;
grant execute on function public.ajouter_ajustement(uuid, text, numeric, boolean, text) to authenticated, service_role;
comment on function public.ajouter_ajustement(uuid, text, numeric, boolean, text) is 'fichier: retenues_releve.sql';

create or replace function public.retirer_ajustement(p_ajustement uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_reg uuid; r public.reglements%rowtype;
begin
  select reglement_id into v_reg from public.reglements_ajustements where id = p_ajustement;
  if v_reg is null then
    raise exception 'Ajustement introuvable.';
  end if;
  r := public.releve_modifiable(v_reg);
  delete from public.reglements_ajustements where id = p_ajustement;
  return public.recalculer_releve(r.id);
end;
$$;
revoke all on function public.retirer_ajustement(uuid) from public, anon;
grant execute on function public.retirer_ajustement(uuid) to authenticated, service_role;
comment on function public.retirer_ajustement(uuid) is 'fichier: retenues_releve.sql';

-- L'ancienne porte des charges (frais_vendeurs.sql) : reprise ici. Elle écrivait
-- frais_divers sans le crédit ni le transfert — l'ancien écran ne doit plus
-- pouvoir s'en servir.
create or replace function public.fixer_charges_releve(p_reglement uuid, p_montant numeric, p_note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Les charges sont maintenant des ajustements : rechargez la page (Ctrl+F5).';
end;
$$;
revoke all on function public.fixer_charges_releve(uuid, numeric, text) from public, anon;
grant execute on function public.fixer_charges_releve(uuid, numeric, text) to authenticated, service_role;
comment on function public.fixer_charges_releve(uuid, numeric, text) is 'fichier: retenues_releve.sql';

-- §5 Les charges existantes → une ligne « Autre » ---------------------------------------------
insert into public.reglements_ajustements (reglement_id, tenant_id, type, montant, en_plus, note, cree_par, cree_le)
select r.id, r.tenant_id, 'autre', abs(r.frais_divers), r.frais_divers < 0,
       coalesce(nullif(btrim(r.frais_divers_note), ''), 'Charges'), null, r.created_at
  from public.reglements r
 where r.frais_divers <> 0
   and not exists (select 1 from public.reglements_ajustements a where a.reglement_id = r.id);

-- §6 Répétition et vérification -----------------------------------------------------------------
do $$
declare c record; x record; n integer;
begin
  for c in select * from (values
      -- base,  crédit, ajust, %,   transfert, net
      (79000, 10000,     0, 1.5,      1035, 67965),
      (79000, 10000,  1000, 1.5,      1020, 66980),
      (79000,     0,     0, 1.5,      1185, 77815),
      (52500,     0,     0, 0,           0, 52500),
      (52500,     0,  -500, 0,           0, 53000),
      ( 1000,  2000,     0, 10,          0, -1000)) v(base, credit, ajust, pct, tr, net)
  loop
    select * into x from public.calcul_net_releve(c.base, c.credit, c.ajust, c.pct);
    if x.frais_transfert <> c.tr or x.net <> c.net then
      raise exception 'retenues_releve.sql : le calcul se trompe (base %, crédit %, ajustements %, % %%) : % / % au lieu de % / %. Rien n''est installé.',
        c.base, c.credit, c.ajust, c.pct, x.frais_transfert, x.net, c.tr, c.net;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.reglements_ajustements', 'insert')
     or has_table_privilege('authenticated', 'public.reglements_ajustements', 'update')
     or has_table_privilege('authenticated', 'public.reglements_ajustements', 'delete') then
    raise exception 'retenues_releve.sql : un compte peut écrire les ajustements en direct. Rien n''est installé.';
  end if;
  if has_function_privilege('authenticated', 'public.recalculer_releve(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.releve_modifiable(uuid)', 'execute') then
    raise exception 'retenues_releve.sql : une fonction interne est appelable par un compte. Rien n''est installé.';
  end if;
  -- Les charges reprises : chaque relevé à charges a sa ligne, au même total.
  select count(*) into n from public.reglements r
   where r.frais_divers is distinct from (select coalesce(sum(case when a.en_plus then -a.montant else a.montant end), 0)
                                            from public.reglements_ajustements a where a.reglement_id = r.id);
  if n > 0 then
    raise exception 'retenues_releve.sql : % relevé(s) dont les charges ne sont pas égales à leurs ajustements. Rien n''est installé.', n;
  end if;
  raise notice 'retenues_releve.sql : crédit d''expédition, ajustements, frais de transfert installés ; charges existantes reprises en lignes. Relancez maintenant reglement_atomique.sql.';
end $$;

commit;
