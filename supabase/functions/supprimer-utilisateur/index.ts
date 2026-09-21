// Delete a user account. Business rows (agents / livreurs) are kept for history,
// only their user_id is cleared.
// Allowed: `gerer_utilisateurs` / `gerer_comptes` + super_admin, same rules as modification.
import {
  adminClient, getCaller, handle, HttpError, json, readJson, requireAny, ROLES_PRIVILEGIES,
} from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['gerer_utilisateurs', 'gerer_comptes'])

  const { user_id } = await readJson(req) as { user_id?: string }
  if (!user_id) throw new HttpError(400, 'L\'identifiant utilisateur (user_id) est requis.')
  if (user_id === caller.userId) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte')

  if (!caller.isSuperAdmin) {
    const { data: cible } = await sb
      .from('user_roles')
      .select('tenant_id, role, roles(nom)')
      .eq('user_id', user_id)
      .maybeSingle()
    if (!cible || cible.tenant_id !== caller.tenantId) throw new HttpError(403, 'Utilisateur hors de votre entreprise')
    // deno-lint-ignore no-explicit-any
    const roleCible = String((cible as any).roles?.nom ?? cible.role ?? '').toLowerCase()
    if (roleCible === 'super_admin') throw new HttpError(403, 'Impossible de supprimer un super_admin')
    if (ROLES_PRIVILEGIES.includes(roleCible) && caller.roleNom !== 'admin') {
      throw new HttpError(403, `Seul un admin peut supprimer un compte ${roleCible}`)
    }
  }

  await sb.from('agents').update({ user_id: null, actif: false }).eq('user_id', user_id)
  await sb.from('livreurs').update({ user_id: null, actif: false }).eq('user_id', user_id)
  await sb.from('user_roles').delete().eq('user_id', user_id)

  const { error } = await sb.auth.admin.deleteUser(user_id)
  if (error) throw new HttpError(400, error.message)

  return json({ status: 'ok', message: 'Compte supprimé avec succès' })
}))