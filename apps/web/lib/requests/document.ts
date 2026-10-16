import { DocumentData } from '@/hooks/use-file-editor';

export interface SaveDocumentResult {
  success: boolean;
  document: DocumentData | null;
  error: string | null;
}

export async function saveDocument(
  projectId: string,
  fileId: string,
  content: string
): Promise<SaveDocumentResult> {
  try {
    const response = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    console.log('Save response:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Save failed:', errorText);
      return {
        success: false,
        document: null,
        error: `Failed to save document with status ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    console.log('Save successful:', data);

    return {
      success: true,
      document: data.document,
      error: null,
    };
  } catch (error) {
    console.error('Error saving document:', error);
    return {
      success: false,
      document: null,
      error: error instanceof Error ? error.message : 'Failed to save document',
    };
  }
}
