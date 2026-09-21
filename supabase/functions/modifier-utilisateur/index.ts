// Change a user's email and/or password.
// Allowed: `gerer_utilisateurs` / `gerer_comptes` + super_admin, with the same rules as creation:
// same tenant only, never a super_admin (unless caller is super_admin),
// admin/ceo/manager accounts only by an admin.
import {
  adminClient, getCaller, handle, HttpError, json, readJson, requireAny, ROLES_PRIVILEGIES,
} from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['gerer_utilisateurs', 'gerer_comptes'])

    const { user_id, email, nouveau_mdp, nom } = await readJson(req) as Record<string, string | undefined>
  if (!user_id) throw new HttpError(400, 'L\'identifiant utilisateur (user_id) est requis.')

  if (!caller.isSuperAdmin) {
    const { data: cible } = await sb
      .from('user_roles')
      .select('tenant_id, role, roles(nom)')
      .eq('user_id', user_id)
      .maybeSingle()
    if (!cible || cible.tenant_id !== caller.tenantId) throw new HttpError(403, 'Utilisateur hors de votre entreprise')
    // deno-lint-ignore no-explicit-any
    const roleCible = String((cible as any).roles?.nom ?? cible.role ?? '').toLowerCase()
    if (roleCible === 'super_admin') throw new HttpError(403, 'Impossible de modifier un super_admin')
    if (ROLES_PRIVILEGIES.includes(roleCible) && caller.roleNom !== 'admin' && user_id !== caller.userId) {
      throw new HttpError(403, `Seul un admin peut modifier un compte ${roleCible}`)
    }
  }

  // deno-lint-ignore no-explicit-any
  const updateData: Record<string, any> = {}
  if (email) updateData.email = email
  if (nouveau_mdp && nouveau_mdp.trim() !== '') updateData.password = nouveau_mdp

  if (Object.keys(updateData).length > 0) {
    const { error } = await sb.auth.admin.updateUserById(user_id, updateData)
    if (error) throw new HttpError(400, error.message)
  }

  if (email) await sb.from('user_roles').update({ email }).eq('user_id', user_id)

  // Keep the name identical everywhere it is displayed
  if (nom && nom.trim() !== '') {
    const n = nom.trim()
    await sb.from('user_roles').update({ nom: n }).eq('user_id', user_id)
    await sb.from('agents').update({ nom: n }).eq('user_id', user_id)
    await sb.from('livreurs').update({ nom: n }).eq('user_id', user_id)
  }

  return json({ status: 'ok' })
}))