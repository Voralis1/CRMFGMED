# CRM FGMED — Démarrage

## 1. Installer les dépendances
```
npm install
```

## 2. Configurer la connexion Supabase
1. Copie `.env.local.example` vers un nouveau fichier `.env.local`
2. Va dans Supabase -> Settings -> API
3. Copie "Project URL" -> colle dans NEXT_PUBLIC_SUPABASE_URL
4. Copie "anon public" key -> colle dans NEXT_PUBLIC_SUPABASE_ANON_KEY

## 3. Créer un utilisateur de test
Dans Supabase -> Authentication -> Users -> "Add user" -> crée un email/mot de passe.
C'est avec ce compte que tu te connecteras sur la page de login.

## 4. Lancer le projet en local
```
npm run dev
```
Ouvre http://localhost:3000 dans ton navigateur.

## 5. Déployer gratuitement (quand tu es prête)
1. Pousse ce dossier sur un repo GitHub
2. Va sur vercel.com -> "New Project" -> importe le repo
3. Ajoute les mêmes variables d'environnement (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) dans les settings Vercel
4. Deploy

## Structure du projet
- `app/page.js` -> page de connexion (login)
- `app/dashboard/page.js` -> liste des commandes
- `lib/supabaseClient.js` -> connexion à la base (à ne jamais dupliquer, toujours importer depuis ici)
