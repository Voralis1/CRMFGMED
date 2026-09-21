// Create a company (tenant) and its first admin account.
// Before: NO authentication at all (anyone on the internet could create a company + admin).
// Now: super_admin only.
import { adminClient, getCaller, handle, HttpError, json, readJson } from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  if (!caller.isSuperAdmin) throw new HttpError(403, 'Réservé au super_admin')

  const { nomEntreprise, adminEmail, adminPassword, adminNom } =
    await readJson(req) as Record<string, string | undefined>
  if (!nomEntreprise || !adminEmail || !adminPassword) {
    throw new HttpError(400, 'Tous les champs (nomEntreprise, adminEmail, adminPassword) sont obligatoires.')
  }

  // Role names are lowercase in the roles table ('admin', not 'ADMIN').
  const { data: roleAdmin } = await sb
    .from('roles')
    .select('id')
    .eq('nom', 'admin')
    .eq('is_system', true)
    .maybeSingle()
  if (!roleAdmin) throw new HttpError(500, 'Le rôle système "admin" est introuvable dans la table roles.')

  const { data: tenant, error: tenantError } = await sb
    .from('tenants')
    .insert([{ nom_entreprise: nomEntreprise.trim() }])
    .select()
    .single()
  if (tenantError) throw new HttpError(400, `Erreur création entreprise: ${tenantError.message}`)

  const { data: authData, error: authError } = await sb.auth.admin.createUser({
    email: adminEmail.trim(),
    password: adminPassword,
    email_confirm: true,
  })
  if (authError) {
    await sb.from('tenants').delete().eq('id', tenant.id)
    throw new HttpError(400, `Erreur création compte Admin: ${authError.message}`)
  }

  const userId = authData.user.id
  const nom = adminNom || adminEmail.split('@')[0]

  const { error: userRoleError } = await sb.from('user_roles').insert([{
    user_id: userId,
    role_id: roleAdmin.id,
    role: 'admin',
    tenant_id: tenant.id,
    email: adminEmail.trim(),
    nom,
  }])
  if (userRoleError) {
    await sb.auth.admin.deleteUser(userId)
    await sb.from('tenants').delete().eq('id', tenant.id)
    throw new HttpError(400, `Erreur liaison rôle: ${userRoleError.message}`)
  }

  await sb.from('agents').insert({ user_id: userId, nom, tenant_id: tenant.id, actif: true })

  return json({ success: true, tenant, message: 'Entreprise et Admin créés avec succès !' })
}))