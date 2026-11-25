-- =============================================================================
-- CORRESPONDANCES SKU → PRODUIT (+ MULTIPLICATEUR), PAR SOURCE — 03/11/2026
-- Fichier 1 sur 2. NE MODIFIE AUCUNE COMMANDE EXISTANTE (le fichier 2 le fait).
-- =============================================================================
--
-- POURQUOI (lu le 03/11). La boutique de Tarik (source « Ma boutique »,
-- 59768ff7…) envoie de vrais leads depuis le 02/11 : 45 commandes, AUCUNE
-- liée à un produit. Chaque ligne porte un titre (« Chá de Limpeza do Fígado -
-- Pacote Recomendado – 2 unidades ») et un SKU (« Livertea-AO-2 ») ; ni l'un ni
-- l'autre n'est un code du catalogue (« livertea »). Et un pack de 2 unités
-- arrive en quantité 1 : la livraison sortirait 1 unité au lieu de 2.
--
-- LA RÈGLE (sa décision, 03/11) :
--   · une LIGNE EXPLICITE par SKU et par source : SKU → produit + multiplicateur.
--     On ne DÉCOUPE JAMAIS « code-AO-unités » : c'est la convention de cette
--     boutique, pas une règle ; si elle change, un découpage se tromperait en
--     silence. Un SKU sans ligne ne correspond à rien → « Produit non reconnu »
--     (visible au tableau de bord).
--   · le produit d'une ligne appartient au VENDEUR DE LA SOURCE, toujours (sa
--     règle : même nom chez deux vendeurs = deux produits différents ; on ne
--     les mélange jamais). Refusé sinon, par tous les chemins.
--   · à la CRÉATION d'une commande d'une source, une seule ligne d'article avec
--     un SKU qui a sa correspondance → produit_id = ce produit, quantité ×
--     multiplicateur (le prix reste le total du pack), et
--     commandes.multiplicateur_sku garde la trace (1, 2…) : jamais multiplié
--     deux fois.
--   · pas de correspondance → la règle d'avant, inchangée (produit_de_commande
--     sur le texte de la commande). Voir « CE QUI N'EST PAS FAIT » plus bas.
--   · commande à plusieurs lignes → inchangée (le trou connu « multi-produits »).
--
-- LA LIVRAISON lit désormais commandes.produit_id d'abord (changement dans
-- stock_livraison_autre_vendeur.sql, même jour) : sans ça, ce lien ne ferait
-- rien sortir du stock — elle relisait le produit depuis le TEXTE.
--
-- CE QUE FAIT LE FICHIER :
--   §1 prérequis (produit_id, articles, sources_import.vendeur_id) ;
--   §2 table correspondances_sku + garde (entreprise, source, vendeur) ;
--      lecture : responsables de l'entreprise + super admin ; écriture : SQL
--      seulement (pas d'écran pour l'instant) ;
--   §3 commandes.multiplicateur_sku + le trigger trg_zz_produit_sku (après
--      trg_zz_produit_commande : l'ordre des noms) ;
--   §4 les 16 correspondances de « Ma boutique », écrites une par une ;
--   §5 répétition (annulée) : vraie commande « clé service » avec SKU connu /
--      inconnu / sans SKU / plusieurs lignes ; ligne vers le produit d'un
--      autre vendeur refusée. Un échec → rien n'est installé.
--
-- ORDRE : stock_livraison_autre_vendeur.sql (la livraison lit produit_id),
-- puis CE fichier, puis correspondances_sku_2_rattrapage.sql.
-- RETOUR ARRIÈRE : correspondances_sku_retour.sql (copie sur le Bureau) — refuse
-- tant que le fichier 2 n'est pas défait (correspondances_sku_2_retour.sql).
-- =============================================================================

begin;

-- §1 Prérequis -----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'commandes' and column_name = 'produit_id')
     or not exists (select 1 from pg_trigger where tgname = 'trg_zz_produit_commande') then
    raise exception 'correspondances_sku.sql : commandes.produit_id absent — lancez commandes_produit_id.sql d''abord. Rien n''est installé.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'commandes' and column_name = 'articles') then
    raise exception 'correspondances_sku.sql : commandes.articles absent (intake_generique.sql). Rien n''est installé.';
  end if;
  if position('to_jsonb(v_cmd) ->> ''produit_id''' in
              pg_get_functiondef('public.fn_ajuster_stock_livraison()'::regprocedure)) = 0 then
    raise exception 'correspondances_sku.sql : la livraison relit encore le produit depuis le texte — lancez stock_livraison_autre_vendeur.sql (03/11) d''abord. Rien n''est installé.';
  end if;
end $$;

-- §2 La table ------------------------------------------------------------------
create table if not exists public.correspondances_sku (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  source_id      uuid not null references public.sources_import(id) on delete cascade,
  sku            text not null check (btrim(sku) <> ''),
  produit_id     uuid not null references public.produits(id) on delete cascade,
  multiplicateur integer not null default 1 check (multiplicateur between 1 and 100),
  titre_vu       text,           -- le titre que la boutique envoyait : pour le lecteur, jamais lu par la règle
  cree_le        timestamptz not null default now(),
  cree_par       uuid default auth.uid()
);
comment on table public.correspondances_sku is
  'fichier: correspondances_sku.sql — un SKU d''une source → un produit du vendeur de la source + multiplicateur. Jamais de découpage du SKU.';
create unique index if not exists correspondances_sku_source_sku
  on public.correspondances_sku (source_id, lower(btrim(sku)));

create or replace function public.correspondances_sku_garde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_src public.sources_import%rowtype; v_prod public.produits%rowtype;
begin
  select * into v_src from public.sources_import where id = new.source_id;
  select * into v_prod from public.produits where id = new.produit_id;
  if v_src.tenant_id is distinct from new.tenant_id then
    raise exception 'Correspondance SKU : la source n''est pas de cette entreprise.';
  end if;
  if v_prod.tenant_id is distinct from new.tenant_id then
    raise exception 'Correspondance SKU : le produit n''est pas de cette entreprise.';
  end if;
  if v_prod.vendeur_id is distinct from v_src.vendeur_id then
    raise exception 'Correspondance SKU « % » : le produit « % » n''est pas celui du vendeur de la source. Deux vendeurs = deux produits, même sous le même nom.',
      new.sku, v_prod.product;
  end if;
  new.sku := btrim(new.sku);
  return new;
end;
$$;
revoke all on function public.correspondances_sku_garde() from public, anon, authenticated;
drop trigger if exists trg_correspondances_sku_garde on public.correspondances_sku;
create trigger trg_correspondances_sku_garde
  before insert or update on public.correspondances_sku
  for each row execute function public.correspondances_sku_garde();

alter table public.correspondances_sku enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'correspondances_sku'
  loop execute format('drop policy %I on public.correspondances_sku', p.policyname); end loop;
end $$;
create policy lecture_correspondances_sku on public.correspondances_sku
  for select to authenticated
  using (public.is_super_admin() or (tenant_id = public.get_my_tenant_id() and public.est_responsable()));
revoke all on public.correspondances_sku from anon, authenticated;
grant select on public.correspondances_sku to authenticated;
grant all on public.correspondances_sku to service_role;

-- §3 La trace sur la commande, et le trigger -----------------------------------
alter table public.commandes add column if not exists multiplicateur_sku integer;
comment on column public.commandes.multiplicateur_sku is
  'correspondances_sku.sql : la quantité de la boutique a été multipliée par ce nombre (pack). NULL = jamais. Jamais deux fois.';

-- La correspondance d'une commande : une seule ligne d'article, un SKU, une ligne pour cette source.
create or replace function public.correspondance_de_commande(p_source uuid, p_articles jsonb)
returns table (produit_id uuid, multiplicateur integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.produit_id, c.multiplicateur
    from public.correspondances_sku c
   where p_source is not null
     and jsonb_typeof(p_articles) = 'array' and jsonb_array_length(p_articles) = 1
     and c.source_id = p_source
     and lower(btrim(c.sku)) = lower(btrim(nullif(p_articles -> 0 ->> 'code', '')));
$$;
revoke all on function public.correspondance_de_commande(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.correspondance_de_commande(uuid, jsonb) to service_role;

create or replace function public.commande_produit_sku()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_prod uuid; v_mult integer;
begin
  -- La trace ne s'écrit pas à la main (sauf le rattrapage du fichier 2).
  if tg_op = 'UPDATE' and new.multiplicateur_sku is distinct from old.multiplicateur_sku
     and coalesce(current_setting('crm.produit_rattrapage', true), '') <> 'oui' then
    raise exception 'commandes.multiplicateur_sku ne s''écrit pas à la main.';
  end if;
  if tg_op = 'INSERT' and new.multiplicateur_sku is not null then
    new.multiplicateur_sku := null;   -- un client ne la fournit pas
  end if;

  select c.produit_id, c.multiplicateur into v_prod, v_mult
    from public.correspondance_de_commande(new.source_id, new.articles) c;
  if v_prod is null then
    return new;                       -- pas de correspondance : la règle d'avant (trg_zz_produit_commande)
  end if;

  if tg_op = 'INSERT' then
    new.produit_id         := v_prod;
    new.quantite           := coalesce(new.quantite, 1) * v_mult;
    new.multiplicateur_sku := v_mult;
  elsif new.produit is distinct from old.produit or new.tenant_id is distinct from old.tenant_id then
    -- trg_zz_produit_commande vient de recalculer depuis le texte : la correspondance l'emporte.
    -- La quantité n'est PAS re-multipliée.
    new.produit_id := v_prod;
  end if;
  return new;
end;
$$;
revoke all on function public.commande_produit_sku() from public, anon, authenticated;
comment on function public.commande_produit_sku() is 'fichier: correspondances_sku.sql';

-- « zz_produit_sku » : après trg_zz_produit_commande (les triggers BEFORE tournent dans l'ordre des noms).
drop trigger if exists trg_zz_produit_sku on public.commandes;
create trigger trg_zz_produit_sku
  before insert or update of produit, tenant_id, multiplicateur_sku on public.commandes
  for each row execute function public.commande_produit_sku();

-- §4 Les 16 correspondances de « Ma boutique » (Fgmed Angola, vendeur Tarik) -----
-- Une ligne par SKU, écrite à la main. Le produit est désigné par SON code du
-- catalogue, chez le vendeur de la source seulement. Relu par lui avant de lancer.
do $$
declare
  v_source uuid := '59768ff7-30a8-4c05-9ab2-c4d9c70e1978';
  v_src    public.sources_import%rowtype;
  r        record;
  v_prod   uuid;
  n        integer;
  v_ajout  integer := 0;
begin
  select * into v_src from public.sources_import where id = v_source;
  if not found then
    raise exception 'correspondances_sku.sql : la source « Ma boutique » (59768ff7…) n''existe plus. Rien n''est installé.';
  end if;
  for r in select * from (values
      ('bonegel-AO-1',   'bonegel',   1, 'Cuidado Articular de Ação Rápida - Pacote Solo – 1 unidade'),
      ('clearzal-AO-1',  'clearzal',  1, 'ClearZal™ – Alívio Rápido - Pacote Solo – 1 unidade'),
      ('Colontea-AO-1',  'colontea',  1, 'Chá de Limpeza do Cólon para Constipação Crónica e Colopatia Funcional - Pacote Solo – 1 unidade'),
      ('Colontea-AO-2',  'colontea',  2, 'Chá de Limpeza do Cólon para Constipação Crónica e Colopatia Funcional - Pacote Recomendado – 2 unidades'),
      ('gingeroil-AO-1', 'gingeroil', 1, 'Óleo de Gengibre, Drenagem Abdominal - Pacote Solo – 1 unidade'),
      ('gingeroil-AO-2', 'gingeroil', 2, 'Óleo de Gengibre, Drenagem Abdominal - Pacote Recomendado – 2 unidades'),
      ('goldhuile-AO-1', 'goldhuile', 1, 'GOLDENOIL™ – Dores articulares - Pacote Solo – 1 unidade'),
      ('kidneytea-AO-1', 'kidneytea', 1, '🌞 Chá DETOX para a limpeza dos rins e cálculos renais - Pacote Solo – 1 unidade'),
      ('kidneytea-AO-2', 'kidneytea', 2, '🌞 Chá DETOX para a limpeza dos rins e cálculos renais - Pacote Recomendado – 2 unidades'),
      ('Livertea-AO-1',  'livertea',  1, 'Chá de Limpeza do Fígado - Pacote Solo – 1 unidade'),
      ('Livertea-AO-2',  'livertea',  2, 'Chá de Limpeza do Fígado - Pacote Recomendado – 2 unidades'),
      ('Retinol-AO-1',   'Retinol',   1, 'Creme de Retinol Anti-Idade e Anti-Rugas para o Rosto - Pacote Solo – 1 unidade'),
      ('Retinol-AO-2',   'Retinol',   2, 'Creme de Retinol Anti-Idade e Anti-Rugas para o Rosto - Pacote Recomendado – 2 unidades'),
      ('Sp4-AO-1',       'Sp4',       1, 'SP-4 Clareador – Elimina anos de manchas - Pacote Solo – 1 unidade'),
      ('warming-AO-1',   'warming',   1, 'Spray Anti-dor - Pacote Solo – 1 unidade'),
      ('warming-AO-2',   'warming',   2, 'Spray Anti-dor - Pacote Recomendado – 2 unidades')
    ) as t(sku, code, mult, titre)
  loop
    select count(*), min(p.id::text)::uuid into n, v_prod
      from public.produits p
     where p.tenant_id = v_src.tenant_id and p.vendeur_id = v_src.vendeur_id
       and lower(btrim(p.code)) = lower(r.code);
    if n <> 1 then
      raise exception 'correspondances_sku.sql : le code « % » (pour le SKU « % ») donne % produit(s) chez le vendeur de la source, 1 attendu. Rien n''est installé.',
        r.code, r.sku, n;
    end if;
    insert into public.correspondances_sku (tenant_id, source_id, sku, produit_id, multiplicateur, titre_vu)
    values (v_src.tenant_id, v_source, r.sku, v_prod, r.mult, r.titre)
    on conflict (source_id, lower(btrim(sku))) do nothing;
    get diagnostics n = row_count;
    v_ajout := v_ajout + n;
  end loop;
  raise notice 'correspondances_sku.sql : % correspondance(s) ajoutée(s) (16 au premier passage, 0 ensuite).', v_ajout;
end $$;

-- §5 Répétition (annulée) --------------------------------------------------------
do $$
declare
  v_source uuid := '59768ff7-30a8-4c05-9ab2-c4d9c70e1978';
  v_src    public.sources_import%rowtype;
  v_pays   uuid;
  v_liver  uuid;
  v_autre  uuid;
  c        record;
  v_msg    text;
  v_etape  text := 'préparation';
  v_refus  boolean;
begin
  select * into v_src from public.sources_import where id = v_source;
  select id into v_pays from public.pays where tenant_id = v_src.tenant_id order by nom limit 1;
  select id into v_liver from public.produits
   where tenant_id = v_src.tenant_id and vendeur_id = v_src.vendeur_id and lower(btrim(code)) = 'livertea';
  begin
    -- comme import-commande : la clé service
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    execute 'set local role service_role';

    v_etape := 'SKU connu, pack de 2';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix,
                                  pays_id, ville_zone, vendeur_id, source_id, source, articles)
    values (v_src.tenant_id, 'REPETITION-SKU-' || gen_random_uuid(), 'Répétition', '+000',
            'Chá de Limpeza do Fígado - Pacote Recomendado – 2 unidades', 1, 45000, v_pays, 'Répétition',
            v_src.vendeur_id, v_source, 'webhook',
            '[{"code":"Livertea-AO-2","prix":45000,"produit":"Chá de Limpeza do Fígado - Pacote Recomendado – 2 unidades","quantite":1}]')
    returning produit_id, quantite, prix, multiplicateur_sku into c;
    if c.produit_id is distinct from v_liver or c.quantite <> 2 or c.prix <> 45000 or c.multiplicateur_sku <> 2 then
      raise exception 'attendu Liver Detox Tea ×2 à 45000, lu % / % / % / %', c.produit_id, c.quantite, c.prix, c.multiplicateur_sku;
    end if;

    v_etape := 'SKU inconnu → non reconnu, quantité intacte';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix,
                                  pays_id, ville_zone, vendeur_id, source_id, source, articles)
    values (v_src.tenant_id, 'REPETITION-SKU-' || gen_random_uuid(), 'Répétition', '+000',
            'Produit nouveau - Pacote Solo – 1 unidade', 1, 35000, v_pays, 'Répétition',
            v_src.vendeur_id, v_source, 'webhook',
            '[{"code":"nouveau-AO-1","prix":35000,"produit":"Produit nouveau - Pacote Solo – 1 unidade","quantite":1}]')
    returning produit_id, quantite, multiplicateur_sku into c;
    if c.produit_id is not null or c.quantite <> 1 or c.multiplicateur_sku is not null then
      raise exception 'un SKU inconnu a reçu un produit ou une quantité (% / % / %)', c.produit_id, c.quantite, c.multiplicateur_sku;
    end if;

    v_etape := 'ligne sans SKU → la règle d''avant (texte = code du catalogue)';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix,
                                  pays_id, ville_zone, vendeur_id, source_id, source, articles)
    values (v_src.tenant_id, 'REPETITION-SKU-' || gen_random_uuid(), 'Répétition', '+000',
            'livertea', 1, 35000, v_pays, 'Répétition', v_src.vendeur_id, v_source, 'webhook',
            '[{"prix":35000,"produit":"livertea","quantite":1}]')
    returning produit_id, quantite, multiplicateur_sku into c;
    if c.produit_id is distinct from v_liver or c.quantite <> 1 or c.multiplicateur_sku is not null then
      raise exception 'sans SKU, la règle d''avant ne s''applique plus (% / % / %)', c.produit_id, c.quantite, c.multiplicateur_sku;
    end if;

    v_etape := 'deux lignes → inchangé';
    insert into public.commandes (tenant_id, lead_id, client_nom, client_telephone, produit, quantite, prix,
                                  pays_id, ville_zone, vendeur_id, source_id, source, articles)
    values (v_src.tenant_id, 'REPETITION-SKU-' || gen_random_uuid(), 'Répétition', '+000',
            'A ×1 + B ×1', 2, 70000, v_pays, 'Répétition', v_src.vendeur_id, v_source, 'webhook',
            '[{"code":"Livertea-AO-2","quantite":1},{"code":"Sp4-AO-1","quantite":1}]')
    returning produit_id, quantite, multiplicateur_sku into c;
    if c.produit_id is not null or c.quantite <> 2 or c.multiplicateur_sku is not null then
      raise exception 'une commande à deux lignes a été touchée (% / % / %)', c.produit_id, c.quantite, c.multiplicateur_sku;
    end if;

    execute 'reset role';

    v_etape := 'correspondance vers le produit d''un autre vendeur refusée';
    select id into v_autre from public.produits
     where tenant_id = v_src.tenant_id and vendeur_id is distinct from v_src.vendeur_id limit 1;
    if v_autre is null then
      -- aucun autre vendeur dans l'entreprise : on en fabrique un, annulé avec le reste
      insert into public.produits (tenant_id, product, code, vendeur_id)
      values (v_src.tenant_id, 'Répétition autre vendeur', 'repetition-autre-' || left(gen_random_uuid()::text, 8), null)
      returning id into v_autre;
    end if;
    v_refus := false;
    begin
      insert into public.correspondances_sku (tenant_id, source_id, sku, produit_id, multiplicateur)
      values (v_src.tenant_id, v_source, 'REPETITION-AUTRE', v_autre, 1);
    exception when others then v_refus := sqlerrm like '%vendeur de la source%';
    end;
    if not v_refus then raise exception 'une correspondance vers le produit d''un autre vendeur est acceptée'; end if;

    raise exception 'REPETITION_OK';
  exception when others then
    v_msg := sqlerrm;
    execute 'reset role';
    if v_msg <> 'REPETITION_OK' then
      raise exception 'correspondances_sku.sql — RÉPÉTITION ÉCHOUÉE à l''étape « % », rien n''est installé : %', v_etape, v_msg;
    end if;
  end;
  raise notice 'correspondances_sku.sql : SKU connu → produit ×multiplicateur, SKU inconnu → non reconnu, sans SKU → règle d''avant (répétition annulée).';
end $$;

commit;

-- Ce qui est en place
select c.sku, p.product as produit, p.code, c.multiplicateur
  from public.correspondances_sku c join public.produits p on p.id = c.produit_id
 order by p.product, c.multiplicateur;
