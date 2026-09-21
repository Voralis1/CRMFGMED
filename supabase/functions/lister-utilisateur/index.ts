// List user accounts with their role and tenant.
// Before: NO authentication at all (anyone could list every email of every tenant).
// Now: super_admin sees everyone; a user with `gerer_utilisateurs` only sees his own tenant.
import { adminClient, getCaller, handle, json, requireAny } from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['gerer_utilisateurs', 'gerer_comptes'])

  let requete = sb.from('user_roles').select('*')
  if (!caller.isSuperAdmin) requete = requete.eq('tenant_id', caller.tenantId)
  const { data: userRoles, error: roleError } = await requete
  if (roleError) throw roleError

  const { data: authUsers, error: authError } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (authError) throw authError

  const comptes = (userRoles || []).map((ur) => {
    const match = authUsers.users.find((u) => u.id === ur.user_id)
    return { ...ur, email: match?.email ?? ur.email ?? 'Email inconnu' }
  })

  return json({ status: 'ok', comptes })
}))