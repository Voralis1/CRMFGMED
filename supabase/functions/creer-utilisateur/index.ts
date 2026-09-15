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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Vérification de la session
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  const { data: { user }, error: erreurUser } = await supabase.auth.getUser(token)

  if (erreurUser || !user) {
    return new Response(JSON.stringify({ error: 'Non authentifié' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const payload = await req.json()
    const { email, mot_de_passe, nom, telephone, tenant_id, role_id } = payload

    if (!email || !mot_de_passe || !tenant_id || !role_id) {
      return new Response(JSON.stringify({ error: 'email, mot_de_passe, tenant_id et role_id sont requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Récupérer le nom du rôle pour les vérifications et contraintes
    const { data: roleInfo, error: roleError } = await supabase
      .from('roles')
      .select('nom')
      .eq('id', role_id)
      .single()

    if (roleError || !roleInfo) {
      throw new Error("Le rôle sélectionné n'existe pas dans la base de données.")
    }

    const roleNom = roleInfo.nom.toLowerCase()
    const nomAffichage = nom || email.split('@')[0] 

    // 3. Créer le compte dans l'Auth Supabase
    const { data: nouvelUtilisateur, error: erreurCreation } = await supabase.auth.admin.createUser({
      email,
      password: mot_de_passe,
      email_confirm: true,
    })

    if (erreurCreation) throw erreurCreation

    const nouvelUserId = nouvelUtilisateur.user.id

    // 4. Lier l'utilisateur dans user_roles (avec role_id, tenant_id, email et nom)
    const { error: erreurRole } = await supabase
      .from('user_roles')
      .insert({ 
        user_id: nouvelUserId, 
        role_id: role_id,
        role: roleNom, 
        tenant_id: tenant_id,
        email: email,
        nom: nomAffichage // 👈 Stocké pour un affichage direct et rapide dans l'admin
      })

    if (erreurRole) {
      // Rollback de sécurité : si la liaison échoue, on supprime le compte Auth créé
      await supabase.auth.admin.deleteUser(nouvelUserId)
      throw erreurRole
    }

    // 5. Alimenter les tables spécifiques (agents / livreurs) EN INCLUANT LE TENANT_ID 🚀
    if (roleNom.includes('agent') || roleNom.includes('admin')) {
      const { error: agentError } = await supabase.from('agents').insert({ 
        user_id: nouvelUserId, 
        nom: nomAffichage, 
        tenant_id: tenant_id, 
        actif: true 
      })
      if (agentError) console.error("Erreur insertion agent :", agentError.message)

    } else if (roleNom.includes('livreur')) {
      const { error: livreurError } = await supabase.from('livreurs').insert({ 
        user_id: nouvelUserId, 
        nom: nomAffichage, 
        telephone: telephone || null, 
        tenant_id: tenant_id, 
        actif: true 
      })
      if (livreurError) console.error("Erreur insertion livreur :", livreurError.message)
    }

    return new Response(JSON.stringify({ status: 'ok', user_id: nouvelUserId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})