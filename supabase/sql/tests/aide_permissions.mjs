// Aide de test (30/10) : poser ce que la production a, pour que les fonctions
// qui lisent une permission (a_la_permission) répondent comme en vrai :
//   · a_la_permission(code) — le corps de production (rls_sources_import.sql) ;
//   · une ligne `roles` par rôle présent dans user_roles, et user_roles.role_id ;
//   · la permission « actions_masse » à manager, admin, super_admin (production
//     le 30/10, une fois retirée à l'agent comme il l'a décidé).
// À appeler APRÈS avoir créé les comptes (user_roles), AVANT de charger les fichiers.
export async function poserPermissions(db, roles = { actions_masse: ['manager', 'admin', 'super_admin'] }) {
  const q = async (sql, p) => (await db.query(sql, p)).rows
  await db.exec(`create or replace function public.a_la_permission(p_code text) returns boolean
    language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                    where ur.user_id = auth.uid() and rp.permission_code = p_code) $$;`)
  await db.exec(`set session_replication_role = replica`)
  for (const { role } of await q(`select distinct role from public.user_roles where role is not null`)) {
    let id = (await q(`select id from public.roles where nom = $1 limit 1`, [role]))[0]?.id
    if (!id) id = (await q(`insert into public.roles (nom) values ($1) returning id`, [role]))[0].id
    await q(`update public.user_roles set role_id = $1 where role = $2 and role_id is null`, [id, role])
  }
  for (const [code, qui] of Object.entries(roles)) {
    await q(`insert into public.permissions (code, nom, module) select $1, $1, 'Général' where not exists (select 1 from public.permissions where code = $1)`, [code])
    for (const r of qui) {
      const id = (await q(`select id from public.roles where nom = $1 limit 1`, [r]))[0]?.id
      if (id) await q(`insert into public.role_permissions (role_id, permission_code) select $1, $2 where not exists (select 1 from public.role_permissions where role_id = $1 and permission_code = $2)`, [id, code])
    }
  }
  await db.exec(`set session_replication_role = origin`)
}
