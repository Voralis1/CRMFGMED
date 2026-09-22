// Assign a confirmed order to a delivery driver.
// Allowed: roles with permission `assigner_livreur` (manager, admin) + super_admin.
import { adminClient, assertTenant, getCaller, handle, HttpError, json, readJson, requireAny } from '../_shared/auth.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['assigner_livreur'])

  const { commande_id, livreur_id } = await readJson(req) as { commande_id?: string; livreur_id?: string }
  if (!commande_id || !livreur_id) throw new HttpError(400, 'commande_id et livreur_id requis')

  // The tenant comes from the order in the database, never from the browser.
  const { data: commande } = await sb
    .from('commandes')
    .select('id, tenant_id')
    .eq('id', commande_id)
    .maybeSingle()
  if (!commande) throw new HttpError(404, 'Commande introuvable')
  assertTenant(caller, commande.tenant_id)

  const { data: livreur } = await sb
    .from('livreurs')
    .select('id, tenant_id, actif')
    .eq('id', livreur_id)
    .maybeSingle()
  if (!livreur || livreur.tenant_id !== commande.tenant_id) {
    throw new HttpError(400, 'Livreur invalide pour cette entreprise')
  }
  if (livreur.actif === false) throw new HttpError(400, 'Ce livreur est désactivé')

  const { data: livraisonExistante } = await sb
    .from('livraisons')
    .select('id')
    .eq('commande_id', commande_id)
    .maybeSingle()
  if (livraisonExistante) throw new HttpError(400, 'Cette commande est déjà assignée à un livreur.')

  const { data: livraison, error } = await sb
    .from('livraisons')
    .insert({
      commande_id,
      livreur_id,
      tenant_id: commande.tenant_id,
      statut: 'en_attente',
    })
    .select()
    .single()
  if (error) throw new HttpError(400, error.message)

  return json({ status: 'ok', livraison })
}))