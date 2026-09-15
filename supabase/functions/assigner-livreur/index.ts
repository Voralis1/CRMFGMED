import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')
    const { data: { user }, error: erreurUser } = await supabase.auth.getUser(token)

    if (erreurUser || !user) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('roles(nom)')
      .eq('user_id', user.id)
      .maybeSingle()

    const roleNom = roleData?.roles?.nom?.toLowerCase()

    if (!roleNom || (roleNom !== 'admin' && roleNom !== 'super_admin')) {
      return new Response(JSON.stringify({ error: 'Accès refusé : rôle insuffisant' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload = await req.json()
    const { commande_id, livreur_id, tenant_id } = payload

    if (!commande_id || !livreur_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'commande_id, livreur_id et tenant_id requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Vérifier si la commande existe bien
    const { data: commande, error: erreurCmd } = await supabase
      .from('commandes')
      .select('id, statut_confirmation')
      .eq('id', commande_id)
      .eq('tenant_id', tenant_id)
      .single()

    if (erreurCmd || !commande) {
      return new Response(JSON.stringify({ error: 'Commande introuvable' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 🚀 SUPPRESSION DE LA VÉRIFICATION STRICTE 'confirmed'
    // La commande est déjà affichée dans la page d'assignation, on part du principe qu'elle est prête.
    // L'ancien code bloquait ici : if (commande.statut_confirmation !== 'confirmed') ...

    // 2. Vérifier que la commande n'a pas DÉJÀ une livraison active (pour éviter les doublons)
    const { data: livraisonExistante } = await supabase
      .from('livraisons')
      .select('id')
      .eq('commande_id', commande_id)
      .maybeSingle()

    if (livraisonExistante) {
      return new Response(JSON.stringify({ error: 'Cette commande est déjà assignée à un livreur.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Créer l'assignation de livraison avec le statut par défaut "en_attente" ou "a_expedier"
    const { data: livraison, error: erreurLivraison } = await supabase
      .from('livraisons')
      .insert({
        commande_id: commande_id,
        livreur_id: livreur_id,
        tenant_id: tenant_id,
        statut: 'en_attente' // Statut de livraison par défaut
      })
      .select()
      .single()

    if (erreurLivraison) {
      throw erreurLivraison
    }

    return new Response(JSON.stringify({ status: 'ok', livraison }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Erreur interne du serveur' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})