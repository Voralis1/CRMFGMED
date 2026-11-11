import './globals.css'
import AppLayout from './components/AppLayout'
import { AuthProvider } from './context/AuthContext'
import { PermissionsProvider } from './context/PermissionsContext.js' // 🚀 Import ajouté
import { EntrepotProvider } from './context/EntrepotContext'

export const metadata = {
  title: 'CRM FGMED',
  description: 'CRM interne logistique SaaS',
}

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="overflow-hidden">
        <AuthProvider>
          {/* 🚀 On englobe l'application avec les Permissions */}
          <PermissionsProvider>
            {/* L'entrepôt regardé (11/11) : le filtre de tous les écrans. */}
            <EntrepotProvider>
              <AppLayout>
                {children}
              </AppLayout>
            </EntrepotProvider>
          </PermissionsProvider>
        </AuthProvider>
      </body>
    </html>
  )
}