/**
 * Image Content Extractor
 * Uses GPT-4o-mini to describe image content before sending to Claude
 */

export interface ImageToLatexResult {
  success: boolean;
  latex?: string; // Named 'latex' for backward compatibility, but contains any text content
  error?: string;
}

/**
 * Extract content from an image using GPT-4o-mini vision
 * @param imageDataUrl - Data URL of the image (data:image/png;base64,...)
 * @param fileName - Name of the file for context
 * @returns Text description of image content
 */
export async function convertImageToLatex(
  imageDataUrl: string,
  fileName: string
): Promise<ImageToLatexResult> {
  try {
    const response = await fetch('/api/octra-agent/image-to-latex', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: imageDataUrl,
        fileName,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to convert image: ${response.statusText}`,
      };
    }

    // Stream the response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let latex = '';

    if (!reader) {
      return {
        success: false,
        error: 'No response body',
      };
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      latex += decoder.decode(value, { stream: true });
    }

    return {
      success: true,
      latex: latex.trim(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Convert multiple images to LaTeX
 */
export async function convertImagesToLatex(
  images: Array<{ dataUrl: string; fileName: string }>
): Promise<Array<ImageToLatexResult & { fileName: string }>> {
  const results = await Promise.all(
    images.map(async ({ dataUrl, fileName }) => {
      const result = await convertImageToLatex(dataUrl, fileName);
      return { ...result, fileName };
    })
  );

  return results;
}

