-- =============================================================================
-- RETOUR ARRIÈRE de fk_entreprises.sql — 12/11/2026
-- Retire les liens tenant_id → tenants et les index posés par CE fichier (repérés
-- par leur commentaire « fichier: fk_entreprises.sql »), rien d'autre. Rejouable.
-- =============================================================================
begin;
do $$
declare r record; n integer := 0;
begin
  for r in select c.conrelid::regclass as tbl, c.conname
             from pg_constraint c
            where c.contype = 'f' and c.confrelid = 'public.tenants'::regclass
              and obj_description(c.oid, 'pg_constraint') = 'fichier: fk_entreprises.sql' loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    n := n + 1;
  end loop;
  for r in select i.indexrelid::regclass as idx
             from pg_index i
            where obj_description(i.indexrelid, 'pg_class') = 'fichier: fk_entreprises.sql' loop
    execute format('drop index %s', r.idx);
  end loop;
  raise notice 'fk_entreprises_retour.sql : % lien(s) retiré(s), index du fichier retirés.', n;
end $$;
commit;
