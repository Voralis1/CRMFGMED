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
    .select('id, tenant_id, pays_id')
    .eq('id', commande_id)
    .maybeSingle()
  if (!commande) throw new HttpError(404, 'Commande introuvable')
  assertTenant(caller, commande.tenant_id)

  const { data: livreur } = await sb
    .from('livreurs')
    .select('id, tenant_id, actif, pays_id')
    .eq('id', livreur_id)
    .maybeSingle()
  if (!livreur || livreur.tenant_id !== commande.tenant_id) {
    throw new HttpError(400, 'Livreur invalide pour cette entreprise')
  }
  if (livreur.actif === false) throw new HttpError(400, 'Ce livreur est désactivé')
  // A livreur delivers physically: he can only take an order of his own country.
  if (!livreur.pays_id || livreur.pays_id !== commande.pays_id) {
    throw new HttpError(400, 'Ce livreur n\'opère pas dans le pays de cette commande')
  }

  // The database assigns a livreur automatically as soon as the order is
  // confirmed, so a livraison usually already exists. A manager may still change
  // it by hand — but only while the delivery has not been carried out yet:
  // once it is `livre` / `retour` / `injoignable`, money and history depend on it.
  const { data: livraisonExistante } = await sb
    .from('livraisons')
    .select('id, statut, livreur_id')
    .eq('commande_id', commande_id)
    .maybeSingle()

  if (livraisonExistante) {
    if (livraisonExistante.statut !== 'en_attente') {
      throw new HttpError(
        400,
        'Cette livraison a déjà été traitée par le livreur : le livreur ne peut plus être changé.',
      )
    }
    if (livraisonExistante.livreur_id === livreur_id) {
      return json({ status: 'ok', livraison: livraisonExistante, inchange: true })
    }

    const { data: maj, error: erreurMaj } = await sb
      .from('livraisons')
      .update({ livreur_id })
      .eq('id', livraisonExistante.id)
      .eq('statut', 'en_attente') // garde-fou : rien ne change si le livreur vient d'agir
      .select()
      .single()
    if (erreurMaj) throw new HttpError(400, erreurMaj.message)

    return json({ status: 'ok', livraison: maj, remplace: true })
  }

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