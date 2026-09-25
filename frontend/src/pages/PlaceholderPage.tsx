import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/States'
import { Card } from '@/components/ui/card'

/** Stand-in for modules not built yet; routes/RBAC are wired so the shell is navigable. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState title="Đang được xây dựng" description="Trang này sẽ có trong bản cập nhật tới." />
      </Card>
    </>
  )
}
