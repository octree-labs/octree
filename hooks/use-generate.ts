
import { useState, useRef, useEffect, useCallback, useMemo, ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  GenerateActions,
  type GeneratedDocument,
  type StoredAttachment,
  useActiveDocument,
} from '@/stores/generate';
import { Message, MessageAttachment } from '@/components/generate/MessageBubble';
import { markGeneratedFirst } from '@/lib/requests/walkthrough';
import type { ConversationSummary } from '@/types/conversation';
import type { Json } from '@/database.types';

export interface AttachedFile {
  id: string;
  file: File;
  preview: string | null;
  type: 'image' | 'document';
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ALLOWED_DOC_TYPES = new Set(['application/pdf']);

interface UseGenerateOptions {
  onDocumentCreated?: (documentId: string) => void;
}

export function useGenerate(options: UseGenerateOptions = {}) {
  const { onDocumentCreated } = options;
  const supabase = useMemo(() => createClient(), []);
  const activeDocument = useActiveDocument();

  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentDocument, setCurrentDocument] = useState<GeneratedDocument | null>(null);

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
        errors.push(`${file.name} is too large (max 5MB)`);
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

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    GenerateActions.reset();
    setCurrentDocument(null);
    setMessages([]);
    setError(null);
    setPrompt('');
    setAttachedFiles([]);
  }, []);

  const restoreSession = useCallback((doc: GeneratedDocument) => {
    GenerateActions.setActiveDocument(doc.id);

    let restoredMessages: Message[];
    if (doc.message_history && doc.message_history.length > 0) {
      restoredMessages = doc.message_history.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        attachments: msg.attachments,
      }));
    } else {
      const restoredAttachments: MessageAttachment[] = (doc.attachments || []).map((att) => ({
        id: att.id,
        name: att.name,
        type: att.type,
        preview: att.url,
      }));

      restoredMessages = [
        {
          id: `user-${doc.id}`,
          role: 'user',
          content: doc.prompt,
          attachments: restoredAttachments.length > 0 ? restoredAttachments : undefined,
        },
        {
          id: `assistant-${doc.id}`,
          role: 'assistant',
          content: 'Document generated successfully. Preview it below or open it in Octree.',
        },
      ];
    }

    setCurrentDocument(doc);
    setMessages(restoredMessages);
    setError(null);
    setPrompt('');
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
    if (!userId) {
      setError('Please log in to generate documents.');
      return;
    }

    const isContinuation = !!currentDocument?.id;

    if (!isContinuation && currentDocument) {
      resetState();
    }

    const userPrompt = prompt.trim();
    const documentId = isContinuation ? currentDocument.id : crypto.randomUUID();
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
      id: `user-${documentId}-${Date.now()}`,
      role: 'user',
      content: userPrompt,
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    };

    const assistantMessage: Message = {
      id: `assistant-${documentId}-${Date.now()}`,
      role: 'assistant',
      content: '',
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setPrompt('');
    setIsGenerating(true);
    setError(null);
    setAttachedFiles([]);

    let persistentUserMessage = userMessage;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let streamedContent = '';

    try {
      const filePayload = filesToSend.length > 0
        ? await convertFilesToBase64(filesToSend)
        : undefined;

      // 1. Upload files first so they are available in the DB record
      const uploadedAttachments = await uploadFilesToStorage(
        supabase,
        filesToSend,
        documentId,
        userId
      );

      // Create persistent attachments for message history
      const persistentMessageAttachments: MessageAttachment[] = uploadedAttachments.map((ua) => ({
        id: ua.id,
        name: ua.name,
        type: ua.type,
        preview: ua.url,
      }));

      persistentUserMessage = {
        ...userMessage,
        attachments: persistentMessageAttachments.length > 0 ? persistentMessageAttachments : undefined,
      };

      // 2. Create/Update DB record immediately
      const initialAssistantMessage: Message = { ...assistantMessage, content: '' };
      
      if (isContinuation) {
        const existingAttachments = currentDocument.attachments || [];
        const mergedAttachments = [...existingAttachments, ...uploadedAttachments];
        const newInteractionCount = (currentDocument.interaction_count || 1) + 1;
        const updatedHistory = [...(currentDocument.message_history || []), persistentUserMessage, initialAssistantMessage];

        await supabase.from('generated_documents').update({
          status: 'generating',
          attachments: mergedAttachments as unknown as Json,
          last_user_prompt: userPrompt,
          interaction_count: newInteractionCount,
          message_history: updatedHistory as unknown as Json,
        }).eq('id', documentId);

        // Update local state
        const updates = {
          status: 'generating' as const,
          attachments: mergedAttachments,
          last_user_prompt: userPrompt,
          interaction_count: newInteractionCount,
          message_history: updatedHistory,
        };
        setCurrentDocument((prev) => prev ? { ...prev, ...updates } : prev);
        GenerateActions.updateDocument(documentId, updates);
      } else {
        const initialHistory = [persistentUserMessage, initialAssistantMessage];
        // Create a temporary title from prompt
        const tempTitle = userPrompt.slice(0, 50) + (userPrompt.length > 50 ? '...' : '');
        
        const { data: doc, error: dbError } = await supabase.from('generated_documents').insert({
          id: documentId,
          user_id: userId,
          title: tempTitle,
          prompt: userPrompt,
          latex: '',
          status: 'generating',
          attachments: uploadedAttachments as unknown as Json,
          last_user_prompt: userPrompt,
          last_assistant_response: '',
          interaction_count: 1,
          message_history: initialHistory as unknown as Json,
        }).select().single();

        if (doc) {
          const createdDoc = doc as GeneratedDocument;
          setCurrentDocument(createdDoc);
          GenerateActions.addDocument(createdDoc);
          
          // Silently update URL to persist session ID without reloading
          window.history.replaceState(null, '', `/generate/${documentId}`);
        }
      }

      const requestBody: Record<string, unknown> = {
        prompt: userPrompt,
        files: filePayload,
      };

      if (isContinuation) {
        requestBody.documentId = currentDocument.id;
        requestBody.currentLatex = currentDocument.latex;
        requestBody.conversationSummary = currentDocument.conversation_summary;
        requestBody.lastUserPrompt = currentDocument.last_user_prompt;
        requestBody.lastAssistantResponse = currentDocument.last_assistant_response;
      }

      const response = await fetch('/api/generate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
        // We already uploaded files, just need to final update
        // Note: original code uploaded here, we moved it up.
        // We do NOT need to upload again.

        const successMessage = 'Document generated successfully. Preview it below or open it in Octree.';
        const newUserMessage = {
          id: `user-${documentId}-${Date.now()}`,
          role: 'user' as const,
          content: userPrompt,
          attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
        };
        const newAssistantMessage = {
          id: `assistant-${documentId}-${Date.now()}`,
          role: 'assistant' as const,
          content: successMessage,
        };

        // ... update DB with final latex ...
        if (isContinuation) {
          const existingHistory = currentDocument.message_history || [];
          // We need to replace the last empty assistant message with the success message?
          // Actually, the stream updates the last message content in local state.
          // For DB, we want to save the final history.
          // The `message_history` in DB currently has the empty assistant message.
          // We should update it to have the success message.
          
          // Re-fetch current doc to be safe or construct from known state
          const updatedHistory = [...existingHistory];
          // Replace last assistant message (which was empty/streaming) with success
          // But wait, in continuation we appended [user, assistant].
          // existingHistory refers to history BEFORE this turn?
          // No, `currentDocument` is state. `restoreSession` sets it.
          // In `generateDocument`, we haven't updated `currentDocument` message_history fully locally until now?
          // We did `setMessages`.
          // The DB has `[...prev, user, emptyAssistant]`.
          
          // Let's just construct the final history based on what we want.
          // It should be `[...prev, user, successAssistant]`.
          // We can use `messages` state but it might be async.
          // Best to use the `currentDocument.message_history` we pushed to DB earlier?
          // We pushed `updatedHistory` in step 2.
          
          const historyForDb = [...(currentDocument.message_history || []), userMessage, newAssistantMessage];
           
          // Wait, step 2 pushed `initialAssistantMessage` (empty).
          // We want to replace that one.
          historyForDb[historyForDb.length - 1] = newAssistantMessage;

          const { error: updateError } = await supabase.from('generated_documents')
            .update({
              latex: finalLatex,
              // attachments: ... already up to date
              last_user_prompt: userPrompt,
              last_assistant_response: successMessage,
              // interaction_count: ... already up to date
              message_history: historyForDb as unknown as Json,
              status: 'complete'
            })
            .eq('id', documentId);

          if (updateError) {
            console.error('DB Update Error:', updateError);
          } else {
             const updates = {
              latex: finalLatex,
              last_user_prompt: userPrompt,
              last_assistant_response: successMessage,
              message_history: historyForDb,
              status: 'complete' as const,
            };
            setCurrentDocument((prev) => prev ? { ...prev, ...updates } : prev);
            GenerateActions.updateDocument(documentId, updates);
            
            // Trigger summary...
            if ((currentDocument.interaction_count || 1) + 1 % 2 === 0) {
                 // ...
            }
          }
        } else {
          // New Document Final Update
          // We already inserted the row with `status: generating`.
          // Now we update it to complete.
          
          const historyForDb = [userMessage, newAssistantMessage];
          
          const { error: updateError } = await supabase.from('generated_documents').update({
              latex: finalLatex,
              title: docTitle,
              status: 'complete',
              last_assistant_response: successMessage,
              message_history: historyForDb as unknown as Json
          }).eq('id', documentId);

           if (updateError) console.error('DB Error:', updateError);
           
           // Update local state
           const updates = {
              latex: finalLatex,
              title: docTitle,
              status: 'complete' as const,
              last_assistant_response: successMessage,
              message_history: historyForDb
           };
           // We need to merge with the initial doc we created
           setCurrentDocument(prev => prev ? { ...prev, ...updates } : prev);
           GenerateActions.updateDocument(documentId, updates);
           
           // Use router to ensure we are strictly on the page (though history.replaceState handled URL)
           onDocumentCreated?.(documentId);
        }
      }
    } catch (err) {
      const isAbort = (err as Error).name === 'AbortError';
      const msg = err instanceof Error ? err.message : 'Generation failed';
      
      if (documentId && userId) {
          let partialLatex = isContinuation ? currentDocument?.latex : null;
          if (streamedContent) {
            const codeBlockMatch = streamedContent.match(/```(?:latex|tex)?\s*([\s\S]*)/i);
            if (codeBlockMatch) {
              partialLatex = codeBlockMatch[1].split('```')[0];
            } else if (streamedContent.includes('\\documentclass')) {
               const startIndex = streamedContent.indexOf('\\documentclass');
               partialLatex = streamedContent.substring(startIndex);
            }
          }

          const successMessage = 'Document generated successfully. Preview it below or open it in Octree.';
          const finalAssistantContent = isAbort ? successMessage : (streamedContent || 'Generation failed.');

          const partialAssistantMessage = {
              id: assistantMessage.id,
              role: 'assistant' as const,
              content: finalAssistantContent
          };
          
          let historyForDb: Message[] = [];
          
          if (isContinuation) {
              if (currentDocument?.message_history) {
                  historyForDb = [...currentDocument.message_history];
                  historyForDb[historyForDb.length - 1] = partialAssistantMessage;
              }
          } else {
              historyForDb = [persistentUserMessage, partialAssistantMessage];
          }

          if (historyForDb.length > 0) {
             const status = isAbort ? 'complete' : 'error';
             
             await supabase.from('generated_documents').update({
                  status,
                  latex: partialLatex,
                  last_assistant_response: finalAssistantContent,
                  message_history: historyForDb as unknown as Json
              }).eq('id', documentId);

             const updates = {
                status: status as any,
                latex: partialLatex,
                last_assistant_response: finalAssistantContent,
                message_history: historyForDb as any
             };
             setCurrentDocument((prev) => prev ? { ...prev, ...updates } : prev);
             GenerateActions.updateDocument(documentId, updates);
             setMessages(historyForDb);
          }
      }

      if (isAbort) return;
      
      setError(msg);
      updateLastMessage((m) => (m.content = `Error: ${msg}`));
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [
    prompt,
    isGenerating,
    currentDocument,
    attachedFiles,
    userId,
    supabase,
    resetState,
    updateLastMessage,
    onDocumentCreated,
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
    stopGeneration,
    resetState,
    restoreSession,
    currentDocument,
  };
}

function triggerSummaryGeneration(
  documentId: string,
  currentSummary: ConversationSummary | null,
  prevUserPrompt: string | null,
  prevAssistantResponse: string | null,
  newUserPrompt: string,
  interactionCount: number
) {
  const exchanges: Array<{ userPrompt: string; assistantResponse: string }> = [];

  if (prevUserPrompt && prevAssistantResponse) {
    exchanges.push({
      userPrompt: prevUserPrompt,
      assistantResponse: prevAssistantResponse,
    });
  }

  exchanges.push({
    userPrompt: newUserPrompt,
    assistantResponse: 'Document updated successfully.',
  });

  fetch('/api/generate-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentId,
      currentSummary,
      lastExchanges: exchanges,
      interactionCount,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.summary) {
        GenerateActions.updateDocument(documentId, {
          conversation_summary: data.summary,
        });
      }
    })
    .catch((err) => {
      console.error('Summary generation failed:', err);
    });
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
