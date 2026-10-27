// Save the result of a call on an order (confirmed, cancelled, reminder...).
// Allowed: permission `traiter_appel` (agent, manager, admin) + super_admin.
// An agent can only treat orders assigned to him (or not yet assigned).
import {
  adminClient, assertTenant, getCaller, handle, HttpError, json, myAgentId, readJson, requireAny,
} from '../_shared/auth.ts'
import { adresseManquante, demandeRappel, MESSAGE_ADRESSE_MANQUANTE, rappelRefuse } from '../_shared/appel.ts'

Deno.serve(handle(async (req) => {
  const sb = adminClient()
  const caller = await getCaller(req, sb)
  requireAny(caller, ['traiter_appel'])

  // deno-lint-ignore no-explicit-any
  const payload = await readJson(req) as Record<string, any>
  const {
    commande_id, statut, notes, date_rappel, source, duree_secondes,
    client_nom, client_telephone, ville_zone, adresse, zone_id, pays_id, produit, quantite, prix,
  } = payload

  if (!commande_id || !statut || typeof statut !== 'string') {
    throw new HttpError(400, 'commande_id et statut requis')
  }

  const { data: commande } = await sb
    .from('commandes')
    .select('id, tenant_id, agent_id, statut_confirmation, adresse, pays_id')
    .eq('id', commande_id)
    .maybeSingle()
  if (!commande) throw new HttpError(404, 'Commande introuvable')
  assertTenant(caller, commande.tenant_id)

  const agentId = await myAgentId(sb, caller, commande.tenant_id)

  if (caller.roleNom === 'agent') {
    if (!agentId) throw new HttpError(403, 'Aucun profil agent pour ce compte')
    if (commande.agent_id && commande.agent_id !== agentId) {
      throw new HttpError(403, 'Cette commande est assignée à un autre agent')
    }
  }

  // 0. Le pays envoyé doit être un pays de l'entreprise de la commande. La
  // base le refuse de toute façon (trg_zy_pays_commande, qui ne fait pas
  // d'exception pour la clé service) ; on le vérifie ici AVANT d'écrire
  // l'appel, sinon l'historique garderait un appel dont la commande n'a
  // jamais changé.
  if (pays_id) {
    const { data: paysDeLEntreprise } = await sb
      .from('pays')
      .select('id')
      .eq('id', pays_id)
      .eq('tenant_id', commande.tenant_id)
      .maybeSingle()
    if (!paysDeLEntreprise) {
      throw new HttpError(400, 'Pays refusé : ce pays n\'appartient pas à l\'entreprise de la commande.')
    }
  }

  // 0 bis. Pas de confirmation sans adresse : c'est le seul moment où quelqu'un a
  // le client au téléphone. Vérifié AVANT d'écrire l'appel : un refus ne
  // laisse pas de ligne d'historique « Confirmed » qui n'a jamais eu lieu.
  // L'adresse retenue est celle envoyée avec l'appel, sinon celle déjà là.
  const { data: statuts } = await sb
    .from('statuts')
    .select('nom, code, pays_id, declenche_assignation, necessite_rappel')
    .eq('tenant_id', commande.tenant_id)
  const paysFinal = pays_id || commande.pays_id
  const adresseFinale = adresse !== undefined ? adresse : commande.adresse
  if (adresseManquante(statuts ?? [], statut, paysFinal, adresseFinale)) {
    throw new HttpError(400, MESSAGE_ADRESSE_MANQUANTE)
  }

  // 0 ter. Un statut qui demande un rappel exige une heure à venir, à 30 jours
  // au plus (_shared/appel.ts). Lu sur le drapeau `necessite_rappel`, plus sur
  // le mot. Vérifié AVANT d'écrire l'appel, comme l'adresse.
  const refusRappel = rappelRefuse(statuts ?? [], statut, paysFinal, date_rappel)
  if (refusRappel) throw new HttpError(400, refusRappel)
  // L'instant, en UTC. L'appel garde ce qui a été convenu à CET appel ; la
  // commande porte le rappel en cours — et le perd dès qu'un autre statut est
  // posé (sinon un Unreached garderait l'heure d'un ancien rappel).
  const dateRappel = demandeRappel(statuts ?? [], statut, paysFinal)
    ? new Date(String(date_rappel)).toISOString()
    : null

  // 1. Log the call
  const { data: appel, error: erreurAppel } = await sb
    .from('appels')
    .insert({
      commande_id,
      agent_id: agentId,
      statut,
      // D'où venait la commande, lu AVANT la mise à jour. « Injoignable » ne
      // dit rien ; « En attente → Injoignable » dit qu'on a essayé.
      statut_precedent: commande.statut_confirmation ?? null,
      tenant_id: commande.tenant_id,
      notes: notes || null,
      // Mesurée par l'écran, bornée ici : une valeur absurde (négative, ou un
      // onglet laissé ouvert toute la nuit) fausserait la durée moyenne sans
      // que personne ne s'en aperçoive. Au-delà d'une heure, on ne garde rien
      // plutôt que d'inventer un chiffre.
      duree_secondes: Number.isFinite(Number(duree_secondes))
        && Number(duree_secondes) >= 0
        && Number(duree_secondes) <= 3600
          ? Math.round(Number(duree_secondes))
          : null,
      date_rappel: dateRappel,
    })
    .select()
    .single()
  if (erreurAppel) throw new HttpError(400, erreurAppel.message)

  // 2. Update the order (only fields that were actually sent)
  // deno-lint-ignore no-explicit-any
  const maj: Record<string, any> = {
    statut_confirmation: statut,
    date_rappel: dateRappel,
    updated_at: new Date().toISOString(),
  }
  if (source !== undefined) maj.source = source || null
  if (client_nom !== undefined) maj.client_nom = client_nom
  if (client_telephone) maj.client_telephone = client_telephone
  if (ville_zone !== undefined) maj.ville_zone = ville_zone
  // Écrite par l'agent pendant l'appel : c'est ce que le livreur lira.
  if (adresse !== undefined) maj.adresse = String(adresse ?? '').trim() || null
  if (zone_id !== undefined) maj.zone_id = zone_id || null
  if (pays_id) maj.pays_id = pays_id // pays_id is NOT NULL in the table: never send null
  if (produit !== undefined) maj.produit = produit
  if (quantite !== undefined) maj.quantite = Math.max(1, parseInt(quantite) || 1)
  if (prix !== undefined) maj.prix = Math.max(0, parseFloat(prix) || 0)
  // An agent who treats an unassigned lead takes it.
  if (caller.roleNom === 'agent' && !commande.agent_id) maj.agent_id = agentId

  const { error: erreurCommande } = await sb
    .from('commandes')
    .update(maj)
    .eq('id', commande_id)
    .eq('tenant_id', commande.tenant_id)
  if (erreurCommande) throw new HttpError(400, erreurCommande.message)

  return json({ status: 'ok', appel })
}))