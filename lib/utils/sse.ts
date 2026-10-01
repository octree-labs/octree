// Reads a text/event-stream body, calling onEvent for each `event:` + JSON `data:` pair.
export async function readStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (type: string, data: Record<string, unknown>) => void
) {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const eventMatch = part.match(/^event:\s*(\S+)/);
      const dataMatch = part.match(/data:\s*([\s\S]+)$/m);
      if (eventMatch && dataMatch) {
        try {
          onEvent(eventMatch[1], JSON.parse(dataMatch[1]));
        } catch {}
      }
    }
  }
}
