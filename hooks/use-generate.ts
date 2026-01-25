
import { useState, useRef, useEffect, ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  GenerateActions,
  useActiveDocument,
  type GeneratedDocument,
  type StoredAttachment,
} from '@/stores/generate';
import { Message, MessageAttachment } from '@/components/generate/MessageBubble';

export interface AttachedFile {
  id: string;
  file: File;
  preview: string | null;
  type: 'image' | 'document';
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const DOCUMENT_TYPES = ['application/pdf'];

export function useGenerate() {
  const supabase = createClient();
  const activeDocument = useActiveDocument();

  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    };
    fetchUser();
  }, [supabase]);

  useEffect(() => {
    return () => {
      attachedFiles.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, [attachedFiles]);

  const addFiles = (filesToCheck: File[]) => {
    const newFiles: AttachedFile[] = [];

    filesToCheck.forEach((file) => {
      if (file.size > MAX_FILE_SIZE) return;

      const isImage = IMAGE_TYPES.includes(file.type);
      const isDocument =
        DOCUMENT_TYPES.includes(file.type) ||
        (file.type === '' && file.name.slice((file.name.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase() === 'pdf') ||
        file.name.toLowerCase().endsWith('.pdf');

      if (!isImage && !isDocument) return;

      newFiles.push({
        id: crypto.randomUUID(),
        file,
        preview: isImage ? URL.createObjectURL(file) : null,
        type: isImage ? 'image' : 'document',
      });
    });

    setAttachedFiles((prev) => [...prev, ...newFiles]);
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    addFiles(Array.from(files));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === fileId);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== fileId);
    });
  };

  const resetState = () => {
      GenerateActions.reset();
      setMessages([]);
      setError(null);
      setPrompt('');
      setAttachedFiles([]);
  }

  const generateDocument = async () => {
    if (!prompt.trim() || isGenerating) return;

    if (activeDocument) {
      GenerateActions.reset();
      setMessages([]);
      setError(null);
    }

    const userPrompt = prompt.trim();
    const documentId = crypto.randomUUID();

    const filesToSend = [...attachedFiles];
    const messageAttachments: MessageAttachment[] = filesToSend.map((f) => ({
      id: f.id,
      name: f.file.name,
      type: f.type,
      preview: f.preview,
    }));

    const userMessage: Message = {
      id: `user-${documentId}`,
      role: 'user',
      content: userPrompt,
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    };

    const assistantMessage: Message = {
      id: `assistant-${documentId}`,
      role: 'assistant',
      content: '',
    };

    setMessages([userMessage, assistantMessage]);
    setPrompt('');
    setIsGenerating(true);
    GenerateActions.reset();
    setError(null);
    setAttachedFiles([]);

    abortControllerRef.current = new AbortController();

    try {
      const files =
        filesToSend.length > 0
          ? await convertFilesToBase64(filesToSend)
          : undefined;

      const response = await fetch('/api/generate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt, files }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let streamedContent = '';
      let finalLatex: string | null = null;
      let documentTitle = 'Untitled Document';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const chunk of lines) {
          const eventMatch = chunk.match(/^event:\s*(\S+)/);
          const dataMatch = chunk.match(/data:\s*([\s\S]+)$/m);

          if (!eventMatch || !dataMatch) continue;

          const eventType = eventMatch[1];
          let eventData: Record<string, unknown>;

          try {
            eventData = JSON.parse(dataMatch[1]);
          } catch {
            continue;
          }

          if (eventType === 'status') {
            const statusMessage = eventData.message as string;
            if (statusMessage) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  last.content = statusMessage;
                }
                return updated;
              });
            }
          } else if (eventType === 'content') {
            const text = eventData.text as string;
            if (text) {
              streamedContent += text;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  last.content = streamedContent;
                }
                return updated;
              });
            }
          } else if (eventType === 'complete') {
            finalLatex = eventData.latex as string;
            documentTitle = (eventData.title as string) || 'Untitled Document';
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === 'assistant') {
                last.content =
                  'Document generated successfully. Preview it below or open it in Octree.';
              }
              return updated;
            });
          } else if (eventType === 'error') {
            throw new Error(eventData.message as string);
          }
        }
      }

      if (finalLatex && userId) {
        const storedAttachments =
          filesToSend.length > 0
            ? await uploadFilesToStorage(supabase, filesToSend, documentId, userId)
            : [];

        filesToSend.forEach((f) => {
          if (f.preview) URL.revokeObjectURL(f.preview);
        });

        const { data: inserted, error: insertError } = await supabase
          .from('generated_documents')
          .insert({
            user_id: userId,
            title: documentTitle,
            prompt: userPrompt,
            latex: finalLatex,
            status: 'complete',
            attachments: storedAttachments,
          } as never)
          .select()
          .single();

        if (insertError) {
          console.error('Failed to save document:', insertError);
        } else if (inserted) {
          GenerateActions.addDocument(inserted as GeneratedDocument);
        }
      } else {
        filesToSend.forEach((f) => {
          if (f.preview) URL.revokeObjectURL(f.preview);
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      const errorMessage =
        err instanceof Error ? err.message : 'Generation failed';
      setError(errorMessage);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          last.content = `Error: ${errorMessage}`;
        }
        return updated;
      });
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  return {
    prompt,
    setPrompt,
    messages,
    setMessages,
    isGenerating,
    error,
    setError,
    attachedFiles,
    setAttachedFiles,
    fileInputRef,
    handleFileSelect,
    addFiles,
    handleRemoveFile,
    generateDocument,
    resetState,
  };
}

async function convertFilesToBase64(
  files: AttachedFile[]
): Promise<{ mimeType: string; data: string; name: string }[]> {
  return Promise.all(
    files.map(
      (f) =>
        new Promise<{ mimeType: string; data: string; name: string }>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64Data = result.split(',')[1];
            resolve({
              mimeType: f.file.type,
              data: base64Data,
              name: f.file.name,
            });
          };
          reader.readAsDataURL(f.file);
        })
    )
  );
}

async function uploadFilesToStorage(
  supabase: ReturnType<typeof createClient>,
  files: AttachedFile[],
  docId: string,
  userId: string
): Promise<StoredAttachment[]> {
  const results: StoredAttachment[] = [];

  for (const f of files) {
    const ext = f.file.name.split('.').pop() || 'bin';
    const path = `${userId}/${docId}/${f.id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(path, f.file, { upsert: true });

    if (uploadError) {
      console.error('Failed to upload file:', uploadError);
      continue;
    }

    const { data: publicUrlData } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(path);

    results.push({
      id: f.id,
      name: f.file.name,
      type: f.type,
      url: publicUrlData.publicUrl,
    });
  }

  return results;
}
