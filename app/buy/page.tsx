import { BuyPageClient } from './buy-page-client';

interface BuyPageProps {
  searchParams: Promise<{ annual?: string }>;
}

export default async function BuyPage({ searchParams }: BuyPageProps) {
  const params = await searchParams;
  const isAnnual = params.annual === 'true';

  return <BuyPageClient isAnnual={isAnnual} />;
}
