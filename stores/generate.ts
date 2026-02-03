import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';

export type DocumentStatus = 'pending' | 'generating' | 'complete' | 'error';

export interface StoredAttachment {
  id: string;
  name: string;
  type: 'image' | 'document';
  url: string;
}

export interface GeneratedDocument {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  latex: string | null;
  status: DocumentStatus;
  error: string | null;
  created_at: string;
  attachments: StoredAttachment[];
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

    setState({ documents: data ?? [], isLoading: false });
  },

  fetchDocument: async (id: string): Promise<GeneratedDocument | null> => {
    const supabase = createClient();
    const { data, error } = await (supabase as any)
      .from('generated_documents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      console.error('Failed to fetch document:', error);
      return null;
    }

    const doc = data as GeneratedDocument;

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

    const { error } = await (supabase as any)
      .from('generated_documents')
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
