/** A compile-service success response: raw PDF bytes, which the route validates by the %PDF magic number */
export function mockPdfResponse(): Response {
  return new Response(Buffer.from('%PDF-1.5\n'), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'x-compile-request-id': 'test',
      'x-compile-duration-ms': '10',
      'x-compile-queue-ms': '0',
    },
  });
}

/** A text/event-stream response emitting the given events, like the agent server */
export function sseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Read an SSE response body into parsed events */
export async function readSse(res: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((raw) => ({
      event: /event:\s*(\S+)/.exec(raw)![1],
      data: JSON.parse(/data:\s*([\s\S]+)/.exec(raw)![1]),
    }));
}
