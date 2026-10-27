// Règles d'un appel qui ne dépendent pas de la base — testables sans Deno :
//   node supabase/tests/test_confirmer_appel.mjs

export interface StatutLigne {
  nom: string | null
  code: string | null
  pays_id: string | null
  declenche_assignation: boolean | null
  necessite_rappel?: boolean | null
}

export const MESSAGE_ADRESSE_MANQUANTE =
  'Ajoutez l\'adresse avant de confirmer. Un repère suffit (« près du marché, maison bleue ») : ' +
  'écrivez ce que le client a dit.'

// Ce statut envoie-t-il la commande au livreur ? Même lecture que le trigger
// auto_affecter_livreur : par nom OU par code, valable pour tous les pays ou
// pour celui de la commande. C'est le DRAPEAU qui compte, pas le mot
// « Confirmed » : la règle suit la table statuts.
export function declencheAssignation(statuts: StatutLigne[], statut: string, paysId: string | null): boolean {
  return statuts.some((s) =>
    (s.nom === statut || s.code === statut)
    && (!s.pays_id || s.pays_id === paysId)
    && s.declenche_assignation === true
  )
}

// Une commande sans adresse ne peut pas être livrée : on refuse de la
// confirmer. Vide = vide après espaces retirés ; n'importe quel texte passe,
// parce qu'ici une adresse est souvent un repère.
export function adresseManquante(
  statuts: StatutLigne[], statut: string, paysId: string | null, adresse: unknown,
): boolean {
  if (!declencheAssignation(statuts, statut, paysId)) return false
  return String(adresse ?? '').trim() === ''
}

// -----------------------------------------------------------------------------
// Le rappel (27/10)
// -----------------------------------------------------------------------------
// Un statut qui demande un rappel (drapeau `necessite_rappel`, pas le mot
// « Reminder ») exige une heure. « Rappelez-moi plus tard » sans heure n'est
// pas une information : c'est un lead qui coule et ne remonte jamais — même
// raisonnement que l'adresse pour Confirmed.
//
// L'heure arrive en ISO AVEC son fuseau (« …Z » ou « +01:00 ») : l'écran
// convertit l'heure locale de l'agent en instant. Une heure sans fuseau est
// refusée : la base (en UTC) la lirait comme UTC, et un rappel tapé 18:00 à
// Luanda tomberait à 19:00.

export const RAPPEL_MAX_JOURS = 30
// L'horloge de l'agent et celle du serveur ne sont jamais tout à fait
// d'accord : deux minutes de grâce avant de dire « déjà passée ».
export const RAPPEL_TOLERANCE_MS = 2 * 60 * 1000

export function demandeRappel(statuts: StatutLigne[], statut: string, paysId: string | null): boolean {
  return statuts.some((s) =>
    (s.nom === statut || s.code === statut)
    && (!s.pays_id || s.pays_id === paysId)
    && s.necessite_rappel === true
  )
}

// null = accepté ; sinon le message à montrer à l'agent.
export function rappelRefuse(
  statuts: StatutLigne[], statut: string, paysId: string | null, dateRappel: unknown,
  maintenant: number = Date.now(),
): string | null {
  if (!demandeRappel(statuts, statut, paysId)) return null
  const texte = String(dateRappel ?? '').trim()
  if (texte === '') {
    return 'Choisissez la date et l\'heure du rappel : sans elles, le lead ne remonte jamais dans la file.'
  }
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(texte) || Number.isNaN(Date.parse(texte))) {
    return 'Heure de rappel illisible : rechargez la page et choisissez-la à nouveau.'
  }
  const t = Date.parse(texte)
  if (t < maintenant - RAPPEL_TOLERANCE_MS) {
    return 'Cette heure de rappel est déjà passée : choisissez un moment à venir.'
  }
  if (t > maintenant + RAPPEL_MAX_JOURS * 24 * 3600 * 1000) {
    return `Un rappel se fixe à ${RAPPEL_MAX_JOURS} jours au plus. Au-delà, ce n'est plus un rappel : annulez, le client reviendra.`
  }
  return null
}
