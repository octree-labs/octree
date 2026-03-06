import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';
import { normalizeGeneratedDocument } from '@/lib/generate/document';
import type { GeneratedDocument } from '@/lib/generate/document';

export type DocumentStatus = GeneratedDocument['status'];
export type { GeneratedDocument, StoredAttachment, StoredMessage } from '@/lib/generate/document';

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

const getState = useGenerateStore.getState;
const setState = useGenerateStore.setState;

export const GenerateActions = {
  fetchDocuments: async () => {
    const supabase = createClient();
    setState({ isLoading: true });

    const { data, error } = await supabase
      .from('generated_documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Failed to fetch documents:', error);
      setState({ isLoading: false });
      return;
    }

    setState({
      documents: (data ?? []).map(normalizeGeneratedDocument),
      isLoading: false,
    });
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
    const { error } = await supabase
      .from('generated_documents')
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

    const { error } = await (supabase
      .from('generated_documents') as any)
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
