// Les NOMS qu'un lead peut donner à chaque champ, UNE SEULE FOIS — pour
// import-commande (Deno, payload JSON) ET pour l'import de fichier de l'écran
// Commandes (navigateur, en-têtes de colonnes). Deux listes avaient divergé :
// « Cidade » passait par l'écran et pas par l'API. Sans dépendance ni import,
// comme pays.ts, pour que la page le charge tel quel.
//
// Ce qui reste VOLONTAIREMENT différent entre les deux côtés — la façon de
// lire, pas les noms :
//   · l'écran a en plus un repli par MOT CONTENU (« Unit Price (USD) »
//     contient « price ») : un en-tête de tableur s'écrit à la main. Le JSON,
//     lui, ne l'a pas : « shipping_total » contient « total » et deviendrait
//     le montant à encaisser.
//   · l'écran ne lit pas de vendeur dans le fichier (c'est qui importe) ;
//     l'API lit en plus pays_code, code, notes, commentaires, url. Ces champs
//     n'ont qu'un lecteur : ils restent dans _shared/import.ts.
//   · le PAYS a les mêmes noms des deux côtés (colonne « Country » depuis le
//     21/10) et la même règle : pays.ts.
//
// L'ORDRE compte : le premier nom qui répond gagne. Les listes commencent par
// les noms historiques de l'API, dans son ordre (un payload plat répond
// exactement comme avant — test_import_generique.mjs §3) ; ce qui vient de
// l'écran et le portugais sont ajoutés en fin de liste.

// "Téléphone (WhatsApp)" → "telephone_whatsapp". Les deux côtés comparent
// les noms sous cette forme.
export function cleNormalisee(cle: unknown): string {
  return String(cle)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export type ChampCommun =
  | 'lead_id' | 'client_nom' | 'client_telephone' | 'pays' | 'ville_zone' | 'adresse'
  | 'produit' | 'quantite' | 'prix' | 'source_sheet'

export const NOMS: Record<ChampCommun, string[]> = {
  lead_id:          ['lead_id', 'leadid', 'id', 'numero_commande', 'order_id', 'reference', 'ref',
                     'pedido', 'numero_do_pedido', 'id_do_pedido'],
  client_nom:       ['client_nom', 'nom', 'name', 'customer_name', 'full_name', 'nom_client', 'client',
                     'customer', 'consumer_name',
                     'cliente', 'nome', 'nome_do_cliente', 'nome_cliente'],
  client_telephone: ['client_telephone', 'telephone', 'tel', 'phone', 'phone_number', 'numero', 'gsm', 'mobile',
                     'telefone', 'telemovel', 'celular', 'numero_de_telefone'],
  // Le nom du pays tel qu'il est dans le CRM, ou son code ISO2 (pays.ts).
  pays:             ['pays', 'country', 'pays_nom', 'pays_code', 'country_code',
                     'pais'],
  ville_zone:       ['ville_zone', 'ville', 'city', 'zone', 'region',
                     'town', 'localite',
                     'cidade', 'localidade', 'municipio'],
  adresse:          ['adresse', 'address', 'addresse', 'rue', 'address_1', 'address1',
                     'endereco', 'morada'],
  produit:          ['produit', 'product', 'article', 'item', 'offre',
                     'product_name', 'produit_nom', 'product_id',
                     'produto', 'nome_do_produto', 'nome_produto'],
  quantite:         ['quantite', 'quantity', 'qty', 'qte', 'nombre',
                     'quantities',
                     'quantidade', 'qtd'],
  // Le montant à ENCAISSER pour toute la commande, tel que le vendeur l'a
  // écrit — jamais recalculé, jamais multiplié par la quantité (les offres
  // sont dégressives : 1 = 35 000, 2 = 45 000, 3 = 58 000). Pas de
  // « unit_price » / « prix_unitaire » ici : ce sont des prix d'ARTICLE
  // (ALIAS_ARTICLE dans import.ts), et les lire comme montant de commande
  // ferait encaisser le prix d'une seule unité.
  prix:             ['prix', 'price', 'montant', 'total', 'amount', 'cod', 'total_price',
                     'montant_a_encaisser', 'prix_total', 'montant_total',
                     'preco', 'valor', 'preco_total', 'valor_total', 'valor_a_cobrar', 'total_a_pagar'],
  source_sheet:     ['source_sheet', 'feuille', 'sheet',
                     'store', 'store_name', 'boutique',
                     'loja'],
}
