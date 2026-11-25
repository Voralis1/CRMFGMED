-- =============================================================================
-- T15 — LE LIEN « ENTREPRISE » SUR LES 16 TABLES QUI NE L'AVAIENT PAS — 12/11/2026
-- NE MODIFIE AUCUNE DONNÉE. Ajoute 16 clés étrangères tenant_id → tenants (et un
-- index tenant_id là où il n'y en a aucun).
-- =============================================================================
--
-- AVANT (lu en prod le 12/11) : 16 tables ont une colonne tenant_id (NOT NULL)
-- sans lien vers tenants : rien n'empêchait une ligne de pointer vers une
-- entreprise qui n'existe pas, ni la suppression d'une entreprise de laisser ses
-- lignes derrière. Lu le 12/11 : 0 orpheline, 0 tenant_id vide dans les 16.
--
-- LA RÈGLE (décidée le 30/10, docs/ouvert.md) :
--   · CONFIGURATION → CASCADE : pays, zones, entrepots, produits, stocks, livreurs.
--     Une entreprise VIDE (ex. un creer-tenant raté) se supprime avec sa config.
--   · TRAVAIL / ARGENT / HISTORIQUE → RESTRICT : appels, livraisons, paiements,
--     mouvements_stock, expeditions, expeditions_produits, reglements,
--     reglements_commandes, historique_statuts, historique_affectations.
--     Une entreprise qui a travaillé NE SE SUPPRIME PAS (commandes, agents et
--     user_roles la retenaient déjà) : on l'ARCHIVE (Super admin → Entreprises →
--     statut « Archivé »), et depuis entreprise_suspendue.sql (T11) un compte
--     d'une entreprise archivée ou suspendue n'a plus accès à rien. Ses données
--     restent, intactes.
--   Une table qui a DÉJÀ un lien tenant_id → tenants n'est pas touchée (on le dit).
--   Une ligne orpheline trouvée → rien n'est installé, la liste est donnée.
--
--   §1 orphelines ; §2 les liens ; §3 index ; §4 contrôles ; §5 répétition (annulée).
--
-- RETOUR ARRIÈRE : fk_entreprises_retour.sql (copie sur le Bureau) — retire les
-- liens et index posés par ce fichier, rien d'autre.
-- =============================================================================

begin;

create temp table _fk_entreprises (tbl text primary key, regle text not null) on commit drop;
insert into _fk_entreprises values
  ('pays', 'cascade'), ('zones', 'cascade'), ('entrepots', 'cascade'), ('produits', 'cascade'),
  ('stocks', 'cascade'), ('livreurs', 'cascade'),
  ('appels', 'restrict'), ('livraisons', 'restrict'), ('paiements', 'restrict'), ('mouvements_stock', 'restrict'),
  ('expeditions', 'restrict'), ('expeditions_produits', 'restrict'), ('reglements', 'restrict'),
  ('reglements_commandes', 'restrict'), ('historique_statuts', 'restrict'), ('historique_affectations', 'restrict');

-- §1 Orphelines : aucune, sinon rien n'est installé ---------------------------------------
do $$
declare r record; n bigint; v_liste text := '';
begin
  for r in select tbl from _fk_entreprises order by tbl loop
    if to_regclass('public.' || r.tbl) is null then
      raise exception 'fk_entreprises.sql : la table % n''existe pas. Rien n''est installé.', r.tbl;
    end if;
    execute format('select count(*) from public.%I x where x.tenant_id is null
                       or not exists (select 1 from public.tenants t where t.id = x.tenant_id)', r.tbl) into n;
    if n > 0 then v_liste := v_liste || format(' %s (%s)', r.tbl, n); end if;
  end loop;
  if v_liste <> '' then
    raise exception 'fk_entreprises.sql : lignes sans entreprise valide :% — à regarder avant tout lien. Rien n''est installé.', v_liste;
  end if;
end $$;

-- §2 Les liens -----------------------------------------------------------------------------
do $$
declare r record; v_nom text; v_existe text;
begin
  for r in select tbl, regle from _fk_entreprises order by tbl loop
    select c.conname into v_existe
      from pg_constraint c
     where c.contype = 'f' and c.conrelid = ('public.' || r.tbl)::regclass
       and c.confrelid = 'public.tenants'::regclass
       and c.conkey = array[(select a.attnum from pg_attribute a
                              where a.attrelid = c.conrelid and a.attname = 'tenant_id')]::smallint[];
    if v_existe is not null then
      raise notice 'fk_entreprises.sql : % a déjà un lien (%) — pas touché.', r.tbl, v_existe;
      continue;
    end if;
    v_nom := r.tbl || '_tenant_id_fkey';
    if exists (select 1 from pg_constraint where conname = v_nom and conrelid = ('public.' || r.tbl)::regclass) then
      raise exception 'fk_entreprises.sql : une contrainte % existe déjà sur % mais ne pointe pas vers tenants. Rien n''est installé.', v_nom, r.tbl;
    end if;
    execute format('alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id) on delete %s',
                   r.tbl, v_nom, r.regle);
    execute format('comment on constraint %I on public.%I is %L', v_nom, r.tbl, 'fichier: fk_entreprises.sql');
  end loop;
end $$;

-- §3 Un index tenant_id là où AUCUN index ne commence par tenant_id -----------------------
-- (la suppression d'une entreprise et chaque règle RLS cherchent par tenant_id)
do $$
declare r record; v_idx text;
begin
  for r in select tbl from _fk_entreprises order by tbl loop
    if not exists (
      select 1 from pg_index i
       where i.indrelid = ('public.' || r.tbl)::regclass
         and i.indkey[0] = (select a.attnum from pg_attribute a
                             where a.attrelid = i.indrelid and a.attname = 'tenant_id')) then
      v_idx := r.tbl || '_tenant_id_fk_idx';
      execute format('create index %I on public.%I (tenant_id)', v_idx, r.tbl);
      execute format('comment on index public.%I is %L', v_idx, 'fichier: fk_entreprises.sql');
    end if;
  end loop;
end $$;

-- §4 Contrôles : les 16 ont leur lien, avec la bonne règle ---------------------------------
do $$
declare r record; v_regle "char";
begin
  for r in select tbl, regle from _fk_entreprises loop
    select c.confdeltype into v_regle
      from pg_constraint c
     where c.contype = 'f' and c.conrelid = ('public.' || r.tbl)::regclass
       and c.confrelid = 'public.tenants'::regclass
       and c.conkey = array[(select a.attnum from pg_attribute a
                              where a.attrelid = c.conrelid and a.attname = 'tenant_id')]::smallint[]
     limit 1;
    if v_regle is null then
      raise exception 'fk_entreprises.sql : % n''a pas de lien vers tenants. Rien n''est installé.', r.tbl;
    end if;
    if (r.regle = 'cascade' and v_regle <> 'c') or (r.regle = 'restrict' and v_regle not in ('r', 'a')) then
      raise notice 'fk_entreprises.sql : % a un lien existant de règle « % » (attendu %) — laissé tel quel, à décider.', r.tbl, v_regle, r.regle;
    end if;
  end loop;
end $$;

-- §5 Répétition (annulée) : une entreprise vide se supprime avec sa config ;
--    une entreprise qui a un relevé ne se supprime pas ; un lien vers une entreprise
--    inexistante est refusé. Tout est annulé.
do $$
declare v_t uuid; v_pays uuid; v_msg text; v_etape text := 'préparation'; v_refus boolean;
begin
  begin
    v_etape := 'entreprise vide + config';
    insert into public.tenants (nom_entreprise) values ('Répétition fk_entreprises') returning id into v_t;
    insert into public.pays (tenant_id, nom, code, devise) values (v_t, 'Répétition', 'AO', 'AOA') returning id into v_pays;   -- 13/11 : un vrai code (fuseaux_pays.sql refuse un code inconnu)
    insert into public.zones (tenant_id, pays_id, nom_zone) values (v_t, v_pays, 'Répétition');
    delete from public.tenants where id = v_t;
    if exists (select 1 from public.pays where tenant_id = v_t) or exists (select 1 from public.zones where tenant_id = v_t) then
      raise exception 'la config de l''entreprise supprimée est restée';
    end if;

    v_etape := 'entreprise avec un relevé : suppression refusée';
    insert into public.tenants (nom_entreprise) values ('Répétition fk_entreprises 2') returning id into v_t;
    insert into public.reglements (tenant_id, periode_debut, periode_fin) values (v_t, current_date, current_date);
    v_refus := false;
    begin delete from public.tenants where id = v_t;
    exception when foreign_key_violation or restrict_violation then v_refus := true; end;
    if not v_refus then raise exception 'une entreprise avec un relevé s''est supprimée'; end if;

    v_etape := 'lien vers une entreprise inexistante refusé';
    v_refus := false;
    begin insert into public.zones (tenant_id, nom_zone) values (gen_random_uuid(), 'orpheline');
    exception when foreign_key_violation then v_refus := true; end;
    if not v_refus then raise exception 'une zone sans entreprise est acceptée'; end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    if v_msg <> 'REPETITION_OK' then
      raise exception 'fk_entreprises.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'fk_entreprises.sql : 16 tables liées à leur entreprise (config CASCADE, travail / argent / historique RESTRICT). Répétition annulée.';
end $$;

commit;

-- Ce qui est en place
select c.conrelid::regclass as table_, c.conname, case c.confdeltype when 'c' then 'CASCADE' when 'r' then 'RESTRICT' when 'a' then 'NO ACTION' else c.confdeltype::text end as regle
  from pg_constraint c
 where c.contype = 'f' and c.confrelid = 'public.tenants'::regclass
 order by 3, 1;
