import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';
import type { ConversationSummary } from '@/types/conversation';
import { Tables } from '@/database.types';

export type DocumentStatus = GeneratedDocument['status'];

export interface StoredAttachment {
  id: string;
  name: string;
  type: 'image' | 'document';
  url: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    id: string;
    name: string;
    type: 'image' | 'document';
    preview: string | null;
  }>;
}

export interface GeneratedDocument extends Omit<Tables<'generated_documents'>, 'attachments' | 'message_history' | 'conversation_summary' | 'status'> {
  attachments: StoredAttachment[];
  message_history: StoredMessage[];
  conversation_summary: ConversationSummary | null;
  status: Tables<'generated_documents'>['status'];
  created_at: string;
}

type GenerateStoreState = {
  documents: GeneratedDocument[];
  activeDocumentId: string | null;
  isLoading: boolean;
};

const DEFAULT_STATE: GenerateStoreState = {
  documents: [],
  activeDocumentId: null,
  isLoading: true,
};

export const useGenerateStore = create<GenerateStoreState>(() => DEFAULT_STATE);

export const useDocuments = () => useGenerateStore((state) => state.documents);
export const useActiveDocumentId = () => useGenerateStore((state) => state.activeDocumentId);
export const useIsLoading = () => useGenerateStore((state) => state.isLoading);

export const useActiveDocument = () =>
  useGenerateStore((state) => {
    if (!state.activeDocumentId) return null;
    return state.documents.find((d) => d.id === state.activeDocumentId) ?? null;
  });

const getState = useGenerateStore.getState;
const setState = useGenerateStore.setState;

export const GenerateActions = {
  fetchDocuments: async () => {
    const supabase = createClient();
    setState({ isLoading: true });

    const { data, error } = await (supabase.from('generated_documents') as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Failed to fetch documents:', error);
      setState({ isLoading: false });
      return;
    }

    setState({ documents: (data ?? []) as unknown as GeneratedDocument[], isLoading: false });
  },

  fetchDocument: async (id: string): Promise<GeneratedDocument | null> => {
    const supabase = createClient();
    const { data, error } = await (supabase.from('generated_documents') as any)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      console.error('Failed to fetch document:', error);
      return null;
    }

    const doc = data as unknown as GeneratedDocument;

    setState((state) => {
      const exists = state.documents.some((d) => d.id === doc.id);
      return {
        documents: exists
          ? state.documents.map((d) => (d.id === doc.id ? doc : d))
          : [doc, ...state.documents],
        activeDocumentId: doc.id,
      };
    });

    return doc;
  },

  setActiveDocument: (id: string | null) => {
    setState({ activeDocumentId: id });
  },

  addDocument: (doc: GeneratedDocument) => {
    setState((state) => ({
      documents: [doc, ...state.documents],
      activeDocumentId: doc.id,
    }));
  },

  addDocumentWithoutActivating: (doc: GeneratedDocument) => {
    setState((state) => {
      const exists = state.documents.some((d) => d.id === doc.id);
      if (exists) return state;
      return { documents: [doc, ...state.documents] };
    });
  },

  updateDocument: (id: string, updates: Partial<GeneratedDocument>) => {
    setState((state) => ({
      documents: state.documents.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      ),
    }));
  },

  deleteDocument: async (id: string) => {
    const supabase = createClient();
    const { error } = await (supabase
      .from('generated_documents') as any)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete document:', error);
      return false;
    }

    const { activeDocumentId } = getState();
    setState((state) => ({
      documents: state.documents.filter((d) => d.id !== id),
      activeDocumentId: activeDocumentId === id ? null : activeDocumentId,
    }));

    return true;
  },

  renameDocument: async (id: string, newTitle: string) => {
    const supabase = createClient();
    
    setState((state) => ({
      documents: state.documents.map((d) => 
        d.id === id ? { ...d, title: newTitle } : d
      ),
    }));

    const { error } = await (supabase.from('generated_documents') as any)
      .update({ title: newTitle })
      .eq('id', id);

    if (error) {
      console.error('Failed to rename document:', error);
      GenerateActions.fetchDocuments();
      return false;
    }

    return true;
  },

  reset: () => {
    setState({ activeDocumentId: null });
  },
};
