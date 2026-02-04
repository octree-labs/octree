
import { useState, useRef, useEffect, useCallback, ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  GenerateActions,
  useActiveDocument,
  type GeneratedDocument,
  type StoredAttachment,
} from '@/stores/generate';
import { Message, MessageAttachment } from '@/components/generate/MessageBubble';
import type { ConversationSummary } from '@/types/conversation';
import {
  getDocumentSession,
  updateDocumentSession,
  type DocumentSession,
} from '@/lib/document-session';
import { markGeneratedFirst } from '@/lib/requests/walkthrough';

export interface AttachedFile {
  id: string;
  file: File;
  preview: string | null;
  type: 'image' | 'document';
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ALLOWED_DOC_TYPES = new Set(['application/pdf']);

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
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id);
    });
  }, [supabase]);

  useEffect(() => {
    return () => {
      attachedFiles.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, [attachedFiles]);

  const addFiles = useCallback((filesToCheck: File[]) => {
    const newFiles: AttachedFile[] = [];
    const errors: string[] = [];

    for (const file of filesToCheck) {
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name} is too large (max 10MB)`);
        continue;
      }

      const isImage = ALLOWED_IMAGE_TYPES.has(file.type);
      const isPdf = ALLOWED_DOC_TYPES.has(file.type) || file.name.toLowerCase().endsWith('.pdf');

      if (!isImage && !isPdf) {
        errors.push(`${file.name} is not a supported file type`);
        continue;
      }

      newFiles.push({
        id: crypto.randomUUID(),
        file,
        preview: isImage ? URL.createObjectURL(file) : null,
        type: isImage ? 'image' : 'document',
      });
    }

    if (errors.length > 0) {
      setError(errors.join('. '));
    } else {
      setError(null);
    }

    setAttachedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [addFiles]);

  const handleRemoveFile = useCallback((fileId: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === fileId);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== fileId);
    });
  }, []);

  const resetState = useCallback(() => {
    GenerateActions.reset();
    setMessages([]);
    setError(null);
    setPrompt('');
    setAttachedFiles([]);
  }, []);

  const updateLastMessage = useCallback((updater: (msg: Message) => void) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const newMessages = [...prev];
      const lastMsg = { ...newMessages[newMessages.length - 1] };
      updater(lastMsg);
      newMessages[newMessages.length - 1] = lastMsg;
      return newMessages;
    });
  }, []);

  const generateDocument = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    if (activeDocument) resetState();

    const userPrompt = prompt.trim();
    const documentId = crypto.randomUUID();
    const filesToSend = [...attachedFiles];

    const totalSize = filesToSend.reduce((sum, f) => sum + f.file.size, 0);
    if (totalSize > MAX_FILE_SIZE) {
      setError('The total size of attached files is too large. Please use fewer or smaller files.');
      return;
    }

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
    setError(null);
    setAttachedFiles([]);
    GenerateActions.reset();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const filePayload = filesToSend.length > 0
        ? await convertFilesToBase64(filesToSend)
        : undefined;

      const response = await fetch('/api/generate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt, files: filePayload }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 413) {
          throw new Error('Total attachment size is too large for the server. Please try with smaller files.');
        }
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || `Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      let streamedContent = '';
      let finalLatex: string | null = null;
      let docTitle = 'Untitled Document';

      await readStream(reader, (event, data) => {
        switch (event) {
          case 'status':
            if (data.message) {
              updateLastMessage((m) => (m.content = data.message as string));
            }
            break;
          case 'content':
            if (data.text) {
              streamedContent += data.text;
              updateLastMessage((m) => (m.content = streamedContent));
            }
            break;
          case 'complete':
            finalLatex = data.latex as string;
            docTitle = (data.title as string) || docTitle;
            updateLastMessage(
              (m) =>
                (m.content =
                  'Document generated successfully. Preview it below or open it in Octree.')
            );
            break;
          case 'error':
            throw new Error(data.message as string);
        }
      });

      if (finalLatex && userId) {
        const attachments = await uploadFilesToStorage(
          supabase,
          filesToSend,
          documentId,
          userId
        );

        filesToSend.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));

        if (isContinuation) {
          const existingAttachments = activeDocument.attachments || [];
          const mergedAttachments = [...existingAttachments, ...newAttachments];
          
          const currentSession = getDocumentSession(activeDocument.id);
          const newInteractionCount = (currentSession?.interactionCount || 1) + 1;

          const { error: updateError } = await (supabase as any)
            .from('generated_documents')
            .update({
              latex: finalLatex,
              attachments: mergedAttachments,
            })
            .eq('id', documentId);

          if (updateError) {
            console.error('DB Update Error:', updateError);
          } else {
            GenerateActions.updateDocument(documentId, {
              latex: finalLatex,
              attachments: mergedAttachments,
            });

            const updatedSession = updateDocumentSession(documentId, {
              lastUserPrompt: userPrompt,
              lastAssistantResponse: 'Document updated successfully.',
              interactionCount: newInteractionCount,
            });

            if (newInteractionCount % 2 === 0) {
              triggerSummaryGeneration(
                documentId,
                updatedSession.conversationSummary,
                currentSession?.lastUserPrompt ?? null,
                currentSession?.lastAssistantResponse ?? null,
                userPrompt,
                newInteractionCount
              );
            }
          }
        } else {
          const { data: doc, error: dbError } = await supabase
            .from('generated_documents')
            .insert({
              user_id: userId,
              title: docTitle,
              prompt: userPrompt,
              latex: finalLatex,
              status: 'complete',
              attachments: newAttachments,
            } as any)
            .select()
            .single();

          if (dbError) console.error('DB Error:', dbError);
          if (doc) {
            markGeneratedFirst(userId).catch((err) => {
              console.error('Failed to mark first generation:', err);
            });
            const createdDoc = doc as GeneratedDocument;
            GenerateActions.addDocument(createdDoc);
            
            updateDocumentSession(createdDoc.id, {
              conversationSummary: null,
              lastUserPrompt: userPrompt,
              lastAssistantResponse: 'Document created successfully.',
              interactionCount: 1,
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setError(msg);
      updateLastMessage((m) => (m.content = `Error: ${msg}`));
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [
    prompt,
    isGenerating,
    activeDocument,
    attachedFiles,
    userId,
    supabase,
    resetState,
    updateLastMessage,
  ]);

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

async function readStream(
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
        } catch {
          // ignore invalid json
        }
      }
    }
  }
}

async function convertFilesToBase64(files: AttachedFile[]) {
  return Promise.all(
    files.map(
      (f) =>
        new Promise<{ mimeType: string; data: string; name: string }>(
          (resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                mimeType: f.file.type,
                data: (reader.result as string).split(',')[1],
                name: f.file.name,
              });
            reader.onerror = reject;
            reader.readAsDataURL(f.file);
          }
        )
    )
  );
}

async function uploadFilesToStorage(
  supabase: ReturnType<typeof createClient>,
  files: AttachedFile[],
  docId: string,
  userId: string
): Promise<StoredAttachment[]> {
  if (!files.length) return [];

  const uploads = files.map(async (f) => {
    const ext = f.file.name.split('.').pop() || 'bin';
    const path = `${userId}/${docId}/${f.id}.${ext}`;
    const { error } = await supabase.storage
      .from('chat-attachments')
      .upload(path, f.file, { upsert: true });

    if (error) {
      console.error('Upload failed:', error);
      return null;
    }

    const { data } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(path);
    return {
      id: f.id,
      name: f.file.name,
      type: f.type,
      url: data.publicUrl,
    };
  });

  const results = await Promise.all(uploads);
  return results.filter(Boolean) as StoredAttachment[];
}
