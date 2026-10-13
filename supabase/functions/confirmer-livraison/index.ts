// Driver updates a delivery (expédiée / livrée / retour / annulée) and declares the cash amount.
// Allowed: permission `gerer_livraison` (livreur, manager, admin) + super_admin.
// A livreur can only update HIS OWN deliveries, and a delivered order cannot be re-confirmed
// (so the declared amount cannot be changed afterwards).
import {
  adminClient, assertTenant, getCaller, handle, HttpError, json, myLivreurId, readJson, requireAny,
} from '../_shared/auth.ts'

// Les cinq de la table, moins `a_preparer` : celui-là est l'état de départ,
// posé à l'assignation. On ne « repasse » pas une livraison à préparer — la
// marchandise est déjà partie.
const STATUTS_VALIDES = ['expedie', 'livre', 'retour', 'annule']

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['gerer_livraison'])

  const { livraison_id, statut, motif_retour, montant_a_encaisser } =
    await readJson(req) as { livraison_id?: string; statut?: string; motif_retour?: string; montant_a_encaisser?: unknown }

  if (!livraison_id || !statut) throw new HttpError(400, 'livraison_id et statut requis')
  if (!STATUTS_VALIDES.includes(statut)) throw new HttpError(400, 'statut invalide')

  const { data: livraison } = await sb
    .from('livraisons')
    .select('id, commande_id, livreur_id, tenant_id, statut')
    .eq('id', livraison_id)
    .maybeSingle()
  if (!livraison) throw new HttpError(404, 'livraison introuvable')
  assertTenant(caller, livraison.tenant_id)

  if (caller.roleNom === 'livreur') {
    const monId = await myLivreurId(sb, caller)
    if (!monId || livraison.livreur_id !== monId) {
      throw new HttpError(403, 'Cette livraison ne vous est pas assignée')
    }
  }

  // Une livraison close ne se rejoue pas : le montant declare irait une
  // seconde fois dans la caisse du livreur.
  if (['livre', 'retour', 'annule'].includes(livraison.statut)) {
    throw new HttpError(400, `Cette livraison est déjà close (${livraison.statut})`)
  }

  let montant = 0
  if (statut === 'livre') {
    montant = Number(montant_a_encaisser)
    if (!Number.isFinite(montant) || montant < 0) throw new HttpError(400, 'montant invalide')
  }

  const { error: erreurUpdate } = await sb
    .from('livraisons')
    .update({
      statut,
      // Le motif vaut pour un retour comme pour une annulation : dans les
      // deux cas, quelqu'un voudra savoir pourquoi.
      motif_retour: ['retour', 'annule'].includes(statut) ? (motif_retour || null) : null,
      date_livraison: statut === 'livre' ? new Date().toISOString() : null,
    })
    .eq('id', livraison_id)
  if (erreurUpdate) throw new HttpError(400, erreurUpdate.message)

  await sb
    .from('commandes')
    .update({ statut_livraison: statut, updated_at: new Date().toISOString() })
    .eq('id', livraison.commande_id)
    .eq('tenant_id', livraison.tenant_id)

  let paiement = null
  if (statut === 'livre') {
    const { data: dejaPaye } = await sb
      .from('paiements')
      .select('id')
      .eq('commande_id', livraison.commande_id)
      .maybeSingle()
    if (dejaPaye) throw new HttpError(400, 'Un paiement existe déjà pour cette commande')

    const { data: nouveauPaiement, error: erreurPaiement } = await sb
      .from('paiements')
      .insert({
        commande_id: livraison.commande_id,
        livreur_id: livraison.livreur_id,
        tenant_id: livraison.tenant_id,
        montant,
        methode: 'cod',
        statut: 'en_attente',
      })
      .select()
      .single()
    if (erreurPaiement) throw new HttpError(400, 'Erreur création paiement: ' + erreurPaiement.message)

    paiement = nouveauPaiement
    await sb
      .from('commandes')
      .update({ statut_paiement: 'en_attente' })
      .eq('id', livraison.commande_id)
      .eq('tenant_id', livraison.tenant_id)
  }

  return json({ status: 'ok', livraison_id, paiement })
}))