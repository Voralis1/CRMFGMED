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

  let montant = 0
  if (statut === 'livre') {
    montant = Number(montant_a_encaisser)
    if (!Number.isFinite(montant) || montant < 0) throw new HttpError(400, 'montant invalide')
  }

  // La livraison, sa copie sur la commande et le paiement : UNE transaction
  // (enregistrer_livraison, livraison_atomique.sql, 04/11). Avant, trois
  // écritures séparées : si le paiement échouait, la commande restait
  // « livrée », le stock sorti, et aucun paiement — l'argent n'était dans
  // aucune caisse. La fonction refuse aussi une livraison déjà close et un
  // second paiement, avec un message clair.
  const { data: lignes, error } = await sb.rpc('enregistrer_livraison', {
    p_livraison: livraison_id,
    p_statut: statut,
    p_motif: motif_retour ?? null,
    p_montant: statut === 'livre' ? montant : null,
  })
  if (error) throw new HttpError(400, error.message)

  const r = Array.isArray(lignes) ? lignes[0] : lignes
  let paiement = null
  if (r?.paiement_id) {
    const { data } = await sb.from('paiements').select('*').eq('id', r.paiement_id).maybeSingle()
    paiement = data
  }

  return json({ status: 'ok', livraison_id, paiement })
}))
