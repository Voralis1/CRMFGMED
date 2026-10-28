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

  // 0 a. « Renvoyer en attente » (28/10) : le retour à « Pending ». La base le
  // refuse de toute façon hors de ces cas (renvoyer_en_attente.sql §4) ; on
  // le vérifie ici AVANT d'écrire quoi que ce soit, pour un message clair, et
  // le motif — obligatoire — n'existe que dans cette fonction.
  // « Pending » est le TEXTE posé par la base, jamais le mot affiché.
  let notesFinales: string | null = notes ? String(notes) : null
  if (statut === 'Pending') {
    if (commande.statut_confirmation === 'Pending') {
      throw new HttpError(400, 'Cette commande est déjà en attente.')
    }
    if (!caller.isSuperAdmin && !['admin', 'manager'].includes(caller.roleNom)) {
      throw new HttpError(403, 'Renvoi en attente refusé : seuls un manager, un admin ou un super admin peuvent renvoyer une commande en attente.')
    }
    const motif = String(notes ?? '').trim()
    if (!motif) {
      throw new HttpError(400, 'Le motif est obligatoire pour renvoyer une commande en attente.')
    }
    const { data: livraison } = await sb
      .from('livraisons')
      .select('statut, livreurs(nom)')
      .eq('commande_id', commande_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (livraison) {
      // deno-lint-ignore no-explicit-any
      const nom = (livraison as any).livreurs?.nom || 'sans nom'
      const etat: Record<string, string> = { a_preparer: 'à préparer', expedie: 'expédiée', livre: 'livrée', retour: 'retournée', annule: 'annulée' }
      throw new HttpError(400, `Renvoi refusé : le livreur ${nom} a cette commande (livraison ${etat[livraison.statut] ?? livraison.statut}). Un litige sur la livraison se règle dans Livraisons.`)
    }
    notesFinales = `Renvoyé en attente : ${motif}`
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

  // 1. Les champs de la commande envoyés par l'écran (seulement ceux-là).
  // deno-lint-ignore no-explicit-any
  const maj: Record<string, any> = {}
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

  // 2. L'appel, la commande et l'historique des statuts dans UNE transaction
  // (enregistrer_appel, historique_statuts.sql). Avant, l'appel était écrit
  // puis la commande mise à jour : un refus de la commande laissait un appel
  // qui n'avait rien changé. Et la clé service n'a pas d'auth.uid() : c'est
  // `p_fait_par` qui dit à l'historique qui a agi.
  const { data: appel, error } = await sb.rpc('enregistrer_appel', {
    p_commande_id: commande_id,
    p_tenant_id: commande.tenant_id,
    p_fait_par: caller.userId,
    p_agent_id: agentId,
    p_statut: statut,
    // D'où venait la commande, lu AVANT la mise à jour. « Injoignable » ne
    // dit rien ; « En attente → Injoignable » dit qu'on a essayé.
    p_statut_precedent: commande.statut_confirmation ?? null,
    p_notes: notesFinales,
    // Mesurée par l'écran, bornée ici : une valeur absurde (négative, ou un
    // onglet laissé ouvert toute la nuit) fausserait la durée moyenne sans
    // que personne ne s'en aperçoive. Au-delà d'une heure, on ne garde rien
    // plutôt que d'inventer un chiffre. C'est la SEULE mesure : l'historique
    // la recopie, il ne la recalcule pas.
    p_duree_secondes: Number.isFinite(Number(duree_secondes))
      && Number(duree_secondes) >= 0
      && Number(duree_secondes) <= 3600
        ? Math.round(Number(duree_secondes))
        : null,
    p_date_rappel: dateRappel,
    p_maj: maj,
  })
  if (error) throw new HttpError(400, error.message)

  return json({ status: 'ok', appel })
}))