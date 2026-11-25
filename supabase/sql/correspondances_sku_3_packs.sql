-- =============================================================================
-- CORRESPONDANCES SKU — LES PACKS MANQUANTS DE « MA BOUTIQUE » — 09/11/2026
-- AJOUTE 6 CORRESPONDANCES. Ne touche aucune commande (c'est le fichier 2,
-- correspondances_sku_2_rattrapage.sql, relancé APRÈS, qui relie les commandes
-- qui attendent).
-- =============================================================================
--
-- LU EN PROD LE 09/11 : 16 correspondances ; 7 commandes de la boutique non
-- reliées. 6 portent un SKU de pack jamais saisi (« Produit non reconnu ») :
--   clearzal-AO-2, clearzal-AO-3, Sp4-AO-3, Livertea-AO-3, bonegel-AO-2,
--   warming-AO-3 ;
-- la 7e (MABOUTIQUE-9985, kidneytea-AO-1) a un SKU connu mais est arrivée avant
-- sa correspondance — le fichier 2 la relie aussi.
-- Même règle que le fichier 1 : une ligne par SKU, écrite à la main, le produit
-- désigné par SON code chez le vendeur de la source, jamais deviné depuis le
-- SKU. Le multiplicateur = le nombre d'unités du pack (le titre le dit).
--
-- APRÈS CE FICHIER : lancez correspondances_sku_2_rattrapage.sql (rejouable :
-- il ne prend que les commandes pas encore reliées, jamais décomptées). Les
-- commandes reliées passent « En attente » ou « Rupture de stock » d'elles-mêmes
-- (règles de stock du 05/11).
--
-- RETOUR ARRIÈRE : correspondances_sku_3_packs_retour.sql (copie sur le Bureau) —
-- APRÈS correspondances_sku_2_retour.sql si le fichier 2 a relié des commandes.
-- =============================================================================

begin;

do $$
declare
  v_source uuid := '59768ff7-30a8-4c05-9ab2-c4d9c70e1978';
  v_src    public.sources_import%rowtype;
  r        record;
  v_prod   uuid;
  n        integer;
  v_ajout  integer := 0;
begin
  if to_regclass('public.correspondances_sku') is null then
    raise exception 'correspondances_sku_3_packs.sql : lancez correspondances_sku.sql d''abord. Rien n''est ajouté.';
  end if;
  select * into v_src from public.sources_import where id = v_source;
  if not found then
    raise exception 'correspondances_sku_3_packs.sql : la source « Ma boutique » (59768ff7…) n''existe plus. Rien n''est ajouté.';
  end if;
  for r in select * from (values
      ('clearzal-AO-2', 'clearzal', 2, 'ClearZal™ – Alívio Rápido - Pacote Recomendado – 2 unidades'),
      ('clearzal-AO-3', 'clearzal', 3, 'ClearZal™ – Alívio Rápido - Pacote Mais Vendido – 3 unidades'),
      ('Sp4-AO-3',      'Sp4',      3, 'SP-4 Clareador – Elimina anos de manchas - Pacote Mais Vendido – 3 unidades'),
      ('Livertea-AO-3', 'livertea', 3, 'Chá de Limpeza do Fígado - Pacote Mais Vendido – 3 unidades'),
      ('bonegel-AO-2',  'bonegel',  2, 'Cuidado Articular de Ação Rápida - Pacote Recomendado – 2 unidades'),
      ('warming-AO-3',  'warming',  3, 'Spray Anti-dor - Pacote Mais Vendido – 3 unidades')
    ) as t(sku, code, mult, titre)
  loop
    select count(*), min(p.id::text)::uuid into n, v_prod
      from public.produits p
     where p.tenant_id = v_src.tenant_id and p.vendeur_id = v_src.vendeur_id
       and lower(btrim(p.code)) = lower(r.code);
    if n <> 1 then
      raise exception 'correspondances_sku_3_packs.sql : le code « % » (pour le SKU « % ») donne % produit(s) chez le vendeur de la source, 1 attendu. Rien n''est ajouté.',
        r.code, r.sku, n;
    end if;
    insert into public.correspondances_sku (tenant_id, source_id, sku, produit_id, multiplicateur, titre_vu)
    values (v_src.tenant_id, v_source, r.sku, v_prod, r.mult, r.titre)
    on conflict (source_id, lower(btrim(sku))) do nothing;
    get diagnostics n = row_count;
    v_ajout := v_ajout + n;
  end loop;

  -- la preuve : les 6 SKU ont leur correspondance, au bon multiplicateur
  select count(*) into n from public.correspondances_sku c
   where c.source_id = v_source
     and (lower(c.sku), c.multiplicateur) in (('clearzal-ao-2', 2), ('clearzal-ao-3', 3), ('sp4-ao-3', 3),
                                              ('livertea-ao-3', 3), ('bonegel-ao-2', 2), ('warming-ao-3', 3));
  if n <> 6 then
    raise exception 'correspondances_sku_3_packs.sql : % correspondance(s) sur 6 au bon multiplicateur. Rien n''est ajouté.', n;
  end if;
  raise notice 'correspondances_sku_3_packs.sql : % correspondance(s) ajoutée(s) (6 au premier passage, 0 ensuite). Lancez maintenant correspondances_sku_2_rattrapage.sql.', v_ajout;
end $$;

commit;
