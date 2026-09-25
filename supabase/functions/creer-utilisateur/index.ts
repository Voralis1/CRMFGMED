// Create a user account (Auth + user_roles + agents/livreurs row).
// Allowed: `gerer_utilisateurs` (manager, admin) or `gerer_comptes` + super_admin.
// Rules:
//  - a non-super_admin can only create users in HIS OWN tenant
//  - nobody except super_admin can create a super_admin
//  - only admin / super_admin can create admin, ceo or manager accounts
import {
  adminClient, getCaller, handle, HttpError, json, readJson, requireAny, ROLES_PRIVILEGIES,
} from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['gerer_utilisateurs', 'gerer_comptes'])

  const { email, mot_de_passe, nom, telephone, tenant_id, role_id, zone, pays_id } =
    await readJson(req) as Record<string, string | undefined>

  if (!email || !mot_de_passe || !role_id) throw new HttpError(400, 'email, mot_de_passe et role_id sont requis')

  // Target tenant
  let tenantCible: string | undefined
  if (caller.isSuperAdmin) {
    tenantCible = tenant_id
    if (!tenantCible) throw new HttpError(400, 'tenant_id requis')
    const { data: t } = await sb.from('tenants').select('id').eq('id', tenantCible).maybeSingle()
    if (!t) throw new HttpError(400, 'Entreprise introuvable')
  } else {
    if (tenant_id && tenant_id !== caller.tenantId) {
      throw new HttpError(403, 'Vous ne pouvez créer des comptes que dans votre entreprise')
    }
    tenantCible = caller.tenantId
  }

  // Target role
  const { data: roleInfo } = await sb
    .from('roles')
    .select('id, nom, is_system, tenant_id')
    .eq('id', role_id)
    .maybeSingle()
  if (!roleInfo) throw new HttpError(400, 'Le rôle sélectionné n\'existe pas.')
  if (!roleInfo.is_system && roleInfo.tenant_id !== tenantCible) {
    throw new HttpError(400, 'Ce rôle n\'appartient pas à cette entreprise')
  }

  const roleNom = String(roleInfo.nom).toLowerCase()
  if (roleNom === 'super_admin' && !caller.isSuperAdmin) {
    throw new HttpError(403, 'Seul un super_admin peut créer un super_admin')
  }
  if (ROLES_PRIVILEGIES.includes(roleNom) && !caller.isSuperAdmin && caller.roleNom !== 'admin') {
    throw new HttpError(403, `Seul un admin peut créer un compte ${roleNom}`)
  }

  // An agent is routed leads by country and a livreur can only deliver in his own
  // country, so for both the country is mandatory and must belong to their company.
  const estAgent = roleNom === 'agent'
  const estLivreur = roleNom === 'livreur'
  if (estAgent || estLivreur) {
    if (!pays_id) {
      throw new HttpError(400, `Le pays est obligatoire pour un ${estAgent ? 'agent' : 'livreur'}`)
    }
    const { data: pays } = await sb
      .from('pays').select('id').eq('id', pays_id).eq('tenant_id', tenantCible).maybeSingle()
    if (!pays) throw new HttpError(400, 'Ce pays n\'appartient pas à cette entreprise')
  }

  const nomAffichage = nom || email.split('@')[0]

  const { data: nouvel, error: erreurCreation } = await sb.auth.admin.createUser({
    email,
    password: mot_de_passe,
    email_confirm: true,
  })
  if (erreurCreation) throw new HttpError(400, erreurCreation.message)
  const nouvelUserId = nouvel.user.id

  const { error: erreurRole } = await sb.from('user_roles').insert({
    user_id: nouvelUserId,
    role_id: roleInfo.id,
    role: roleNom,
    tenant_id: tenantCible,
    email,
    nom: nomAffichage,
  })
  if (erreurRole) {
    await sb.auth.admin.deleteUser(nouvelUserId)
    throw new HttpError(400, erreurRole.message)
  }

  let avertissement: string | null = null
  if (roleNom.includes('agent') || roleNom.includes('admin')) {
    const { error } = await sb.from('agents').insert({
      user_id: nouvelUserId, nom: nomAffichage, tenant_id: tenantCible, actif: true,
      pays_id: estAgent ? pays_id : (pays_id || null),
    })
    if (error) avertissement = 'Compte créé, mais fiche agent non créée : ' + error.message
  } else if (roleNom.includes('livreur')) {
    const { error } = await sb.from('livreurs').insert({
      user_id: nouvelUserId, nom: nomAffichage, telephone: telephone || null,
      zone: zone || null, pays_id: pays_id, tenant_id: tenantCible, actif: true,
    })
    if (error) avertissement = 'Compte créé, mais fiche livreur non créée : ' + error.message
  }

  return json({ status: 'ok', user_id: nouvelUserId, avertissement })
}))