// Règles d'un appel qui ne dépendent pas de la base — testables sans Deno :
//   node supabase/tests/test_confirmer_appel.mjs

export interface StatutLigne {
  nom: string | null
  code: string | null
  pays_id: string | null
  declenche_assignation: boolean | null
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
