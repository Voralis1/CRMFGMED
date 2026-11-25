-- =============================================================================
-- lead_id : unique par ENTREPRISE + VENDEUR + SOURCE — 27/10/2026
-- =============================================================================
--
-- LE PROBLÈME (arrivé en vrai) : l'unicité était `unique (tenant_id, lead_id)`
-- (lead_id_par_entreprise.sql, 16/10). WooCommerce, Shopify et la plupart des
-- boutiques numérotent leurs commandes depuis 1, chacune pour soi :
--   · le vendeur A importe sa commande 1042 → entre ;
--   · le vendeur B importe SA commande 1042 → refusée par la base. À l'import
--     CSV, tout le paquet de 500 lignes échoue sur « duplicate key » ; B voit
--     la commande dans sa boutique et pas dans le CRM.
--
-- LA RÈGLE :
--
--   unique (tenant_id, coalesce(vendeur_id, 0…0), coalesce(source_id, 0…0), lead_id)
--
--   · vendeur_id : deux vendeurs de la même entreprise (le cas vécu). L'import
--     CSV n'a pas de source : source_id seul ne l'aurait pas résolu.
--   · source_id : un vendeur, deux boutiques (WooCommerce + Shopify), toutes
--     deux depuis 1.
--   · coalesce vers un uuid fixe : Postgres tient deux NULL pour différents
--     dans un index unique ; sans coalesce, deux commandes saisies sans
--     vendeur ni source pourraient partager un numéro.
--
-- CE FICHIER NE PEUT PAS ÉCHOUER SUR LES DONNÉES EXISTANTES : l'ancienne règle
-- est PLUS STRICTE (tout ce qui est unique par entreprise l'est par entreprise
-- + vendeur + source). Vérifié en production le 27/10 : 135 commandes, 0
-- doublon sous l'ancienne clé, 0 sous la nouvelle. Le §1 le revérifie quand
-- même et nomme les lignes avant de toucher à quoi que ce soit.
--
-- idx_commandes_lead_id (btree simple sur lead_id) reste : il sert les
-- recherches par numéro.
--
-- ⚠ Ne relancez pas lead_id_par_entreprise.sql pour « réparer » : il
-- remettrait l'ancienne règle. Depuis le 27/10 il saute son §1 quand
-- l'index de ce fichier existe.
--
-- UNE transaction : la nouvelle unicité est créée AVANT que l'ancienne soit
-- retirée, et la vérification (§3) est faite avant le commit. Si elle échoue,
-- TOUT est annulé et l'ancienne règle reste en place. Exécutable en entier,
-- et deux fois.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Aucune ligne existante ne doit être refusée par la nouvelle règle
-- -----------------------------------------------------------------------------
do $$
declare
  v_liste text;
begin
  select string_agg(format('entreprise %s, vendeur %s, source %s, n° « %s » (%s fois)',
                           tenant_id, coalesce(vendeur_id::text, 'aucun'),
                           coalesce(source_id::text, 'aucune'), lead_id, n), E'\n')
    into v_liste
    from (select tenant_id, vendeur_id, source_id, lead_id, count(*) n
            from public.commandes
           group by 1, 2, 3, 4
          having count(*) > 1) x;
  if v_liste is not null then
    raise exception E'Arrêt : des commandes partagent déjà le même numéro pour le même vendeur et la même source. Rien n''a été modifié.\n%', v_liste;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. La nouvelle règle D'ABORD, l'ancienne ENSUITE
-- -----------------------------------------------------------------------------
create unique index if not exists commandes_lead_id_vendeur_source_key
  on public.commandes (
    tenant_id,
    coalesce(vendeur_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    lead_id
  );

alter table public.commandes drop constraint if exists commandes_tenant_lead_id_key;
-- La règle du 14/10 (unique dans le monde), au cas où elle serait revenue.
alter table public.commandes drop constraint if exists commandes_lead_id_key;

-- -----------------------------------------------------------------------------
-- 3. Vérification — avant le commit : un échec annule tout
-- -----------------------------------------------------------------------------
-- « create unique index if not exists » garde en silence un index du même nom
-- sur d'autres colonnes (CLAUDE.md §6.12) : on relit sa définition exacte.
do $$
declare
  v_def    text;
  v_autres text;
begin
  select pg_get_indexdef(i.indexrelid) into v_def
    from pg_index i
   where i.indexrelid = 'public.commandes_lead_id_vendeur_source_key'::regclass
     and i.indisunique and i.indisvalid;

  if v_def is distinct from
     'CREATE UNIQUE INDEX commandes_lead_id_vendeur_source_key ON public.commandes USING btree '
     || '(tenant_id, COALESCE(vendeur_id, ''00000000-0000-0000-0000-000000000000''::uuid), '
     || 'COALESCE(source_id, ''00000000-0000-0000-0000-000000000000''::uuid), lead_id)' then
    raise exception 'Vérification : l''index commandes_lead_id_vendeur_source_key n''est pas celui attendu : %', coalesce(v_def, 'absent ou invalide');
  end if;

  -- Aucune AUTRE unicité sur lead_id ne doit rester : elle serait plus
  -- stricte et refuserait encore la commande 1042 du second vendeur.
  select string_agg(c.relname || ' : ' || pg_get_indexdef(i.indexrelid), E'\n')
    into v_autres
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where i.indrelid = 'public.commandes'::regclass
     and i.indisunique
     and c.relname <> 'commandes_lead_id_vendeur_source_key'
     and pg_get_indexdef(i.indexrelid) ilike '%lead_id%';
  if v_autres is not null then
    raise exception E'Vérification : une autre unicité sur lead_id est encore là :\n%', v_autres;
  end if;
end $$;

commit;

-- -----------------------------------------------------------------------------
-- 4. Ce qui est en place — à lire dans le résultat
-- -----------------------------------------------------------------------------
-- Une seule ligne attendue : commandes_lead_id_vendeur_source_key.
select c.relname as unicite,
       pg_get_indexdef(i.indexrelid) as definition
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
 where i.indrelid = 'public.commandes'::regclass
   and i.indisunique
   and pg_get_indexdef(i.indexrelid) ilike '%lead_id%';
