import './globals.css'
import AppLayout from './components/AppLayout'
import { AuthProvider } from './context/AuthContext'
import { PermissionsProvider } from './context/PermissionsContext.js' // 🚀 Import ajouté

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
            <AppLayout>
              {children}
            </AppLayout>
          </PermissionsProvider>
        </AuthProvider>
      </body>
    </html>
  )
}