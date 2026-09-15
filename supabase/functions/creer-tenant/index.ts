import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 🚀 LES HEADERS CORS (Indispensables pour éviter le "Failed to fetch")
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1. Gérer la requête préliminaire (Preflight) du navigateur pour le CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Initialiser Supabase en mode ADMIN (Service Role) pour contourner les règles RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Récupérer les données envoyées par Next.js
    const { nomEntreprise, adminEmail, adminPassword } = await req.json()

    if (!nomEntreprise || !adminEmail || !adminPassword) {
      throw new Error("Tous les champs (nomEntreprise, adminEmail, adminPassword) sont obligatoires.")
    }

    // 3. Créer l'entreprise (Tenant)
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert([{ nom_entreprise: nomEntreprise.trim() }])
      .select()
      .single()

    if (tenantError) throw new Error(`Erreur création entreprise: ${tenantError.message}`)

    // 4. Créer l'utilisateur dans auth.users
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail.trim(),
      password: adminPassword,
      email_confirm: true
    })

    if (authError) {
      // Rollback : on supprime l'entreprise si la création du compte échoue
      await supabaseAdmin.from('tenants').delete().eq('id', tenant.id)
      throw new Error(`Erreur création compte Admin: ${authError.message}`)
    }

    const userId = authData.user.id

    // 5. Récupérer l'ID du rôle 'admin' depuis la table relationnelle
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('nom', 'ADMIN') // Assurez-vous que le nom correspond à votre BDD (souvent 'ADMIN' ou 'admin')
      .single()

    if (roleError || !roleData) {
      // Rollback en cas d'échec de récupération du rôle
      await supabaseAdmin.auth.admin.deleteUser(userId)
      await supabaseAdmin.from('tenants').delete().eq('id', tenant.id)
      throw new Error("Le rôle 'admin' n'existe pas dans la table 'roles'.")
    }

    // 6. Lier l'utilisateur à son rôle et à son entreprise
    const { error: userRoleError } = await supabaseAdmin
      .from('user_roles')
      .insert([{
        user_id: userId,
        role_id: roleData.id,
        tenant_id: tenant.id
      }])

    if (userRoleError) {
      // Rollback global si l'association échoue
      await supabaseAdmin.auth.admin.deleteUser(userId)
      await supabaseAdmin.from('tenants').delete().eq('id', tenant.id)
      throw new Error(`Erreur liaison rôle: ${userRoleError.message}`)
    }

    // 7. Succès !
    return new Response(
      JSON.stringify({ success: true, tenant, message: 'Entreprise et Admin créés avec succès !' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})