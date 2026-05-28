import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from '@/layout/AppLayout'
import { ConnectionsPage } from '@/pages/ConnectionsPage'
import { ConnectionFormPage } from '@/pages/ConnectionFormPage'
import { TablesPage } from '@/pages/TablesPage'
import { TableViewPage } from '@/pages/TableViewPage'
import { QueryPage } from '@/pages/QueryPage'
import { ErdPage } from '@/pages/ErdPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<ConnectionsPage />} />
            <Route path="new" element={<ConnectionFormPage mode="new" />} />
            <Route path="c/:conn/edit" element={<ConnectionFormPage mode="edit" />} />
            <Route path="c/:conn" element={<TablesPage />} />
            <Route path="c/:conn/t/:table" element={<TableViewPage />} />
            <Route path="c/:conn/query" element={<QueryPage />} />
            <Route path="c/:conn/erd" element={<ErdPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
