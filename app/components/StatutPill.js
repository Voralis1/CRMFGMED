const STYLES = {
  // --- STATUTS POSITIFS (Marine) ---
  confirmed: { bg: 'bg-marine/10', text: 'text-marine', label: 'Confirmé' },
  livre: { bg: 'bg-marine/10', text: 'text-marine', label: 'Livré' },
  paye: { bg: 'bg-marine/10', text: 'text-marine', label: 'Payé' },
  encaisse: { bg: 'bg-marine/10', text: 'text-marine', label: 'Encaissé' },
  remis: { bg: 'bg-marine/10', text: 'text-marine', label: 'Remis' },

  // --- STATUTS D'ATTENTE OU D'ACTION (Flamme) ---
  unreached: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'Injoignable' },
  reminder: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'À rappeler' },
  en_attente: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'En attente' },
  a_expedier: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'À expédier' },
  non_paye: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'Non payé' },
  out_of_stock: { bg: 'bg-flamme/30', text: 'text-truffe', label: 'Rupture' }, // 🚀 Ajout

  // --- STATUTS NÉGATIFS OU ANNULÉS (Truffe) ---
  cancelled: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Annulé' },
  spam: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Spam' },
  retour: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Retour' },
  injoignable: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Injoignable' },
  double: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Doublon' },
  not_active_yet: { bg: 'bg-oatmeal/60', text: 'text-abyssal/70', label: 'Inactif' }, // 🚀 Ajout
}

export default function StatutPill({ statut }) {
  // Sécurité si la valeur est nulle ou undefined
  if (!statut) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs bg-oatmeal/40 text-abyssal/60">
        En attente
      </span>
    )
  }

  // On cherche le style correspondant, sinon on applique un style gris neutre par défaut
  const style = STYLES[statut] || { bg: 'bg-oatmeal/40', text: 'text-abyssal/70', label: statut }

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap flex items-center gap-1.5 w-fit ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  )
}