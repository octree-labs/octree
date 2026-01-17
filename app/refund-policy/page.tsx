import { FileText, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200">
        <div className="container mx-auto px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-2xl">
          <div className="mb-12 text-center">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
              <FileText className="h-6 w-6 text-blue-600" />
            </div>
            <h1 className="mb-2 text-3xl font-semibold text-neutral-900">
              Refund Policy
            </h1>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
            <div className="space-y-6">
              <p className="text-neutral-700">
                All purchases made on our platform are final and non-refundable.
              </p>

              <p className="text-neutral-600">
                Due to the nature of our digital services and immediate access to
                features upon purchase, we do not offer refunds, returns, or
                exchanges for any subscriptions, credits, or one-time payments
                once they have been processed.
              </p>

              <p className="text-neutral-600">
                Please ensure that you review all product details, pricing, and
                plan features carefully before completing your purchase. If you
                have questions about functionality or suitability, we encourage
                you to try the free version or contact us prior to subscribing.
              </p>

              <div className="pt-4">
                <h2 className="mb-3 text-xl font-semibold text-neutral-900">
                  Exceptions
                </h2>
                <p className="mb-3 text-neutral-600">
                  Refunds will only be considered if:
                </p>
                <ul className="list-disc space-y-2 pl-6 text-neutral-600">
                  <li>
                    You were charged in error (e.g., duplicate charge), or
                  </li>
                  <li>
                    A technical issue on our side prevented access to the service
                    after payment
                  </li>
                </ul>
                <p className="mt-3 text-neutral-600">
                  Such cases are evaluated at our sole discretion.
                </p>
              </div>

              <div className="pt-4">
                <h2 className="mb-3 text-xl font-semibold text-neutral-900">
                  Cancellations
                </h2>
                <p className="text-neutral-600">
                  You may cancel your subscription at any time. Upon cancellation,
                  you will continue to have access to your plan until the end of
                  the current billing period. No partial or prorated refunds are
                  provided.
                </p>
              </div>

              <div className="border-t border-gray-200 pt-6">
                <p className="text-neutral-600">
                  If you believe there has been a billing mistake, please contact
                  us at{' '}
                  <a
                    href="mailto:basil@useoctree.online"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    basil@useoctree.online
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
