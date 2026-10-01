import { getDocumentProxy } from 'unpdf';

type TextItem = { str: string; hasEOL: boolean; transform: number[] };

export async function extractPdfText(
  pdf: Uint8Array
): Promise<{ text: string; totalPages: number }> {
  // pdf.js may detach the buffer it's given, so hand it a copy.
  const doc = await getDocumentProxy(pdf.slice());
  try {
    return { text: await readText(doc), totalPages: doc.numPages };
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function readText(
  doc: Awaited<ReturnType<typeof getDocumentProxy>>
): Promise<string> {
  let text = '';

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const { items } = await page.getTextContent();
    let lastY: number | null = null;

    for (const item of items as TextItem[]) {
      if (typeof item.str !== 'string') continue;
      // pdf.js doesn't always flag line ends (e.g. centered lines), so also
      // break when the baseline moves.
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1) text += '\n';
      text += item.str;
      if (item.hasEOL) text += '\n';
      lastY = y;
    }
    text += '\n';
  }

  return text;
}
