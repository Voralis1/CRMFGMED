// Les pays du monde, pour le champ « Depuis » des expéditions.
//
// Le nom est stocké tel quel en base ; le drapeau est calculé à partir du code
// ISO, jamais enregistré. Deux conséquences utiles : aucune colonne à ajouter,
// et si demain on change l'affichage du drapeau, les données ne bougent pas.
//
// Avant, le champ était libre : « Chine », « chine » et « China » finissaient
// par cohabiter et le filtre par pays devenait inutilisable. En choisissant
// dans cette liste, un pays s'écrit toujours pareil.

export const PAYS_MONDE = [
  { code: 'AF', nom: 'Afghanistan' }, { code: 'ZA', nom: 'Afrique du Sud' },
  { code: 'AL', nom: 'Albanie' }, { code: 'DZ', nom: 'Algérie' },
  { code: 'DE', nom: 'Allemagne' }, { code: 'AD', nom: 'Andorre' },
  { code: 'AO', nom: 'Angola' }, { code: 'SA', nom: 'Arabie saoudite' },
  { code: 'AR', nom: 'Argentine' }, { code: 'AM', nom: 'Arménie' },
  { code: 'AU', nom: 'Australie' }, { code: 'AT', nom: 'Autriche' },
  { code: 'AZ', nom: 'Azerbaïdjan' }, { code: 'BS', nom: 'Bahamas' },
  { code: 'BH', nom: 'Bahreïn' }, { code: 'BD', nom: 'Bangladesh' },
  { code: 'BB', nom: 'Barbade' }, { code: 'BE', nom: 'Belgique' },
  { code: 'BZ', nom: 'Belize' }, { code: 'BJ', nom: 'Bénin' },
  { code: 'BT', nom: 'Bhoutan' }, { code: 'BY', nom: 'Biélorussie' },
  { code: 'BO', nom: 'Bolivie' }, { code: 'BA', nom: 'Bosnie-Herzégovine' },
  { code: 'BW', nom: 'Botswana' }, { code: 'BR', nom: 'Brésil' },
  { code: 'BN', nom: 'Brunei' }, { code: 'BG', nom: 'Bulgarie' },
  { code: 'BF', nom: 'Burkina Faso' }, { code: 'BI', nom: 'Burundi' },
  { code: 'KH', nom: 'Cambodge' }, { code: 'CM', nom: 'Cameroun' },
  { code: 'CA', nom: 'Canada' }, { code: 'CV', nom: 'Cap-Vert' },
  { code: 'CL', nom: 'Chili' }, { code: 'CN', nom: 'Chine' },
  { code: 'CY', nom: 'Chypre' }, { code: 'CO', nom: 'Colombie' },
  { code: 'KM', nom: 'Comores' }, { code: 'CG', nom: 'Congo' },
  { code: 'CD', nom: 'Congo (RDC)' }, { code: 'KR', nom: 'Corée du Sud' },
  { code: 'KP', nom: 'Corée du Nord' }, { code: 'CR', nom: 'Costa Rica' },
  { code: 'CI', nom: "Côte d'Ivoire" }, { code: 'HR', nom: 'Croatie' },
  { code: 'CU', nom: 'Cuba' }, { code: 'DK', nom: 'Danemark' },
  { code: 'DJ', nom: 'Djibouti' }, { code: 'DM', nom: 'Dominique' },
  { code: 'EG', nom: 'Égypte' }, { code: 'AE', nom: 'Émirats arabes unis' },
  { code: 'EC', nom: 'Équateur' }, { code: 'ER', nom: 'Érythrée' },
  { code: 'ES', nom: 'Espagne' }, { code: 'EE', nom: 'Estonie' },
  { code: 'SZ', nom: 'Eswatini' }, { code: 'US', nom: 'États-Unis' },
  { code: 'ET', nom: 'Éthiopie' }, { code: 'FJ', nom: 'Fidji' },
  { code: 'FI', nom: 'Finlande' }, { code: 'FR', nom: 'France' },
  { code: 'GA', nom: 'Gabon' }, { code: 'GM', nom: 'Gambie' },
  { code: 'GE', nom: 'Géorgie' }, { code: 'GH', nom: 'Ghana' },
  { code: 'GR', nom: 'Grèce' }, { code: 'GD', nom: 'Grenade' },
  { code: 'GT', nom: 'Guatemala' }, { code: 'GN', nom: 'Guinée' },
  { code: 'GQ', nom: 'Guinée équatoriale' }, { code: 'GW', nom: 'Guinée-Bissau' },
  { code: 'GY', nom: 'Guyana' }, { code: 'HT', nom: 'Haïti' },
  { code: 'HN', nom: 'Honduras' }, { code: 'HK', nom: 'Hong Kong' },
  { code: 'HU', nom: 'Hongrie' }, { code: 'IN', nom: 'Inde' },
  { code: 'ID', nom: 'Indonésie' }, { code: 'IQ', nom: 'Irak' },
  { code: 'IR', nom: 'Iran' }, { code: 'IE', nom: 'Irlande' },
  { code: 'IS', nom: 'Islande' }, { code: 'IL', nom: 'Israël' },
  { code: 'IT', nom: 'Italie' }, { code: 'JM', nom: 'Jamaïque' },
  { code: 'JP', nom: 'Japon' }, { code: 'JO', nom: 'Jordanie' },
  { code: 'KZ', nom: 'Kazakhstan' }, { code: 'KE', nom: 'Kenya' },
  { code: 'KG', nom: 'Kirghizistan' }, { code: 'KI', nom: 'Kiribati' },
  { code: 'KW', nom: 'Koweït' }, { code: 'LA', nom: 'Laos' },
  { code: 'LS', nom: 'Lesotho' }, { code: 'LV', nom: 'Lettonie' },
  { code: 'LB', nom: 'Liban' }, { code: 'LR', nom: 'Liberia' },
  { code: 'LY', nom: 'Libye' }, { code: 'LI', nom: 'Liechtenstein' },
  { code: 'LT', nom: 'Lituanie' }, { code: 'LU', nom: 'Luxembourg' },
  { code: 'MK', nom: 'Macédoine du Nord' }, { code: 'MG', nom: 'Madagascar' },
  { code: 'MY', nom: 'Malaisie' }, { code: 'MW', nom: 'Malawi' },
  { code: 'MV', nom: 'Maldives' }, { code: 'ML', nom: 'Mali' },
  { code: 'MT', nom: 'Malte' }, { code: 'MA', nom: 'Maroc' },
  { code: 'MU', nom: 'Maurice' }, { code: 'MR', nom: 'Mauritanie' },
  { code: 'MX', nom: 'Mexique' }, { code: 'MD', nom: 'Moldavie' },
  { code: 'MC', nom: 'Monaco' }, { code: 'MN', nom: 'Mongolie' },
  { code: 'ME', nom: 'Monténégro' }, { code: 'MZ', nom: 'Mozambique' },
  { code: 'MM', nom: 'Myanmar' }, { code: 'NA', nom: 'Namibie' },
  { code: 'NP', nom: 'Népal' }, { code: 'NI', nom: 'Nicaragua' },
  { code: 'NE', nom: 'Niger' }, { code: 'NG', nom: 'Nigeria' },
  { code: 'NO', nom: 'Norvège' }, { code: 'NZ', nom: 'Nouvelle-Zélande' },
  { code: 'OM', nom: 'Oman' }, { code: 'UG', nom: 'Ouganda' },
  { code: 'UZ', nom: 'Ouzbékistan' }, { code: 'PK', nom: 'Pakistan' },
  { code: 'PA', nom: 'Panama' }, { code: 'PG', nom: 'Papouasie-Nouvelle-Guinée' },
  { code: 'PY', nom: 'Paraguay' }, { code: 'NL', nom: 'Pays-Bas' },
  { code: 'PE', nom: 'Pérou' }, { code: 'PH', nom: 'Philippines' },
  { code: 'PL', nom: 'Pologne' }, { code: 'PT', nom: 'Portugal' },
  { code: 'QA', nom: 'Qatar' }, { code: 'RO', nom: 'Roumanie' },
  { code: 'GB', nom: 'Royaume-Uni' }, { code: 'RU', nom: 'Russie' },
  { code: 'RW', nom: 'Rwanda' }, { code: 'SV', nom: 'Salvador' },
  { code: 'WS', nom: 'Samoa' }, { code: 'ST', nom: 'Sao Tomé-et-Principe' },
  { code: 'SN', nom: 'Sénégal' }, { code: 'RS', nom: 'Serbie' },
  { code: 'SC', nom: 'Seychelles' }, { code: 'SL', nom: 'Sierra Leone' },
  { code: 'SG', nom: 'Singapour' }, { code: 'SK', nom: 'Slovaquie' },
  { code: 'SI', nom: 'Slovénie' }, { code: 'SO', nom: 'Somalie' },
  { code: 'SD', nom: 'Soudan' }, { code: 'SS', nom: 'Soudan du Sud' },
  { code: 'LK', nom: 'Sri Lanka' }, { code: 'SE', nom: 'Suède' },
  { code: 'CH', nom: 'Suisse' }, { code: 'SR', nom: 'Suriname' },
  { code: 'SY', nom: 'Syrie' }, { code: 'TJ', nom: 'Tadjikistan' },
  { code: 'TW', nom: 'Taïwan' }, { code: 'TZ', nom: 'Tanzanie' },
  { code: 'TD', nom: 'Tchad' }, { code: 'CZ', nom: 'Tchéquie' },
  { code: 'TH', nom: 'Thaïlande' }, { code: 'TL', nom: 'Timor oriental' },
  { code: 'TG', nom: 'Togo' }, { code: 'TO', nom: 'Tonga' },
  { code: 'TT', nom: 'Trinité-et-Tobago' }, { code: 'TN', nom: 'Tunisie' },
  { code: 'TM', nom: 'Turkménistan' }, { code: 'TR', nom: 'Turquie' },
  { code: 'UA', nom: 'Ukraine' }, { code: 'UY', nom: 'Uruguay' },
  { code: 'VU', nom: 'Vanuatu' }, { code: 'VE', nom: 'Venezuela' },
  { code: 'VN', nom: 'Viêt Nam' }, { code: 'YE', nom: 'Yémen' },
  { code: 'ZM', nom: 'Zambie' }, { code: 'ZW', nom: 'Zimbabwe' },
]

// Le drapeau n'est pas une image : deux lettres ISO décalées dans la plage des
// « indicateurs régionaux » Unicode, que le système rend en drapeau. Rien à
// télécharger, rien à héberger, et ça suit le thème du téléphone.
export function drapeau(code) {
  if (!code || code.length !== 2) return ''
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  )
}

// Retrouve le pays à partir du nom enregistré. Les anciennes saisies libres
// ne correspondront à rien : on renvoie null et l'écran affiche le texte seul,
// sans drapeau, plutôt que de refuser de montrer la ligne.
const PAR_NOM = new Map(PAYS_MONDE.map((p) => [p.nom.toLowerCase(), p]))

export function paysParNom(nom) {
  if (!nom) return null
  return PAR_NOM.get(String(nom).trim().toLowerCase()) || null
}

export function drapeauParNom(nom) {
  const p = paysParNom(nom)
  return p ? drapeau(p.code) : ''
}