import './globals.css'
import AppLayout from './components/AppLayout'
import { AuthProvider } from './context/AuthContext'
import { PermissionsProvider } from './context/PermissionsContext.js' // 🚀 Import ajouté
import { EntrepotProvider } from './context/EntrepotContext'
import { MessagesProvider } from './components/Messages'
import { LangueProvider } from './context/LangueContext'

export const metadata = {
  title: 'CRM FGMED',
  description: 'CRM interne logistique SaaS',
}

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="overflow-hidden">
        {/* La langue de l'écran (25/11) : autour de tout, page de connexion comprise. */}
        <LangueProvider>
        <AuthProvider>
          {/* 🚀 On englobe l'application avec les Permissions */}
          <PermissionsProvider>
            {/* L'entrepôt regardé (11/11) : le filtre de tous les écrans. */}
            <EntrepotProvider>
              {/* Les messages du CRM (24/11) : annonces + confirmations, au lieu
                  des fenêtres du navigateur. */}
              <MessagesProvider>
                <AppLayout>
                  {children}
                </AppLayout>
              </MessagesProvider>
            </EntrepotProvider>
          </PermissionsProvider>
        </AuthProvider>
        </LangueProvider>
      </body>
    </html>
  )
}