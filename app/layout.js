import './globals.css'
import AppLayout from './components/AppLayout'

export const metadata = {
  title: 'CRM FGMED',
  description: 'CRM interne logistique',
}

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="overflow-hidden">
        <AppLayout>
          {children}
        </AppLayout>
      </body>
    </html>
  )
}