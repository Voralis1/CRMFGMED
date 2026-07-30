const STYLES = {
  confirmed: { bg: 'bg-marine/10', text: 'text-marine', label: 'Confirmé' },
  livre: { bg: 'bg-marine/10', text: 'text-marine', label: 'Livré' },
  paye: { bg: 'bg-marine/10', text: 'text-marine', label: 'Payé' },
  encaisse: { bg: 'bg-marine/10', text: 'text-marine', label: 'Encaissé' },
  remis: { bg: 'bg-marine/10', text: 'text-marine', label: 'Remis' },

  unreached: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'Injoignable' },
  reminder: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'À rappeler' },
  en_attente: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'En attente' },
  a_expedier: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'À expédier' },
  non_paye: { bg: 'bg-flamme/20', text: 'text-truffe', label: 'Non payé' },

  cancelled: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Annulé' },
  spam: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Spam' },
  retour: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Retour' },
  injoignable: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Injoignable' },
  double: { bg: 'bg-truffe/10', text: 'text-truffe', label: 'Doublon' },
}

export default function StatutPill({ statut }) {
  if (!statut) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs bg-oatmeal/40 text-abyssal/60">
        En attente
      </span>
    )
  }

  const style = STYLES[statut] || { bg: 'bg-oatmeal/40', text: 'text-abyssal/70', label: statut }

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  )
}