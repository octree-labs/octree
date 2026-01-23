'use client';

import { useEffect } from 'react';
import { Plus, Trash2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    useSidebar,
} from '@/components/ui/sidebar';
import {
    useDocuments,
    useActiveDocumentId,
    useIsLoading,
    GenerateActions,
    type GeneratedDocument,
} from '@/stores/generate';

interface GenerateHistorySidebarProps {
    onNewChat: () => void;
    onSelectDocument: (doc: GeneratedDocument) => void;
}

export function GenerateHistorySidebar({
    onNewChat,
    onSelectDocument,
}: GenerateHistorySidebarProps) {
    const { toggleSidebar } = useSidebar();
    const documents = useDocuments();
    const activeDocumentId = useActiveDocumentId();
    const isLoading = useIsLoading();

    useEffect(() => {
        GenerateActions.fetchDocuments();
    }, []);

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const wasActive = activeDocumentId === id;
        const success = await GenerateActions.deleteDocument(id);
        if (success && wasActive) {
            onNewChat();
        }
    };

    const handleSelect = (doc: GeneratedDocument) => {
        GenerateActions.setActiveDocument(doc.id);
        onSelectDocument(doc);
    };

    return (
        <Sidebar collapsible="offcanvas">
            <SidebarHeader className="flex-row items-center justify-between border-b border-gray-200 py-3">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onNewChat}
                    className="flex-1 gap-1.5"
                >
                    <Plus className="h-4 w-4" />
                    New Document
                </Button>
                <button
                    onClick={toggleSidebar}
                    className="ml-2 rounded-md p-1.5 transition-colors hover:bg-gray-100"
                    aria-label="Close sidebar"
                >
                    <X className="h-4 w-4 text-gray-500" />
                </button>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>History</SidebarGroupLabel>
                    <SidebarGroupContent>
                        {isLoading ? (
                            <div className="flex items-center justify-center p-4">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                        ) : documents.length === 0 ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                                No documents yet
                            </div>
                        ) : (
                            documents.map((doc) => (
                                <div key={doc.id} className="group relative mb-1">
                                    <Button
                                        variant={activeDocumentId === doc.id ? 'secondary' : 'ghost'}
                                        onClick={() => handleSelect(doc)}
                                        className="h-auto w-full justify-start gap-2 px-3 py-3 pr-8 text-left"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <span className="line-clamp-2 block text-sm font-medium">
                                                {doc.title}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(doc.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => handleDelete(doc.id, e)}
                                        className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                                    >
                                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    );
}
