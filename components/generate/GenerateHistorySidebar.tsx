'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, X, MoreHorizontal, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    useDocuments,
    useActiveDocumentId,
    useIsLoading,
    GenerateActions,
    type GeneratedDocument,
} from '@/stores/generate';

export function GenerateHistorySidebar() {
    const router = useRouter();
    const { toggleSidebar } = useSidebar();
    const documents = useDocuments();
    const activeDocumentId = useActiveDocumentId();
    const isLoading = useIsLoading();
    
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        GenerateActions.fetchDocuments();
    }, []);
    
    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingId]);

    const startRenaming = (doc: GeneratedDocument, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(doc.id);
        setEditTitle(doc.title);
    };
    
    const saveRename = async () => {
        if (editingId && editTitle.trim()) {
            await GenerateActions.renameDocument(editingId, editTitle.trim());
        }
        setEditingId(null);
        setEditTitle('');
    };
    
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            saveRename();
        } else if (e.key === 'Escape') {
            setEditingId(null);
        }
    };

    const handleSelect = (doc: GeneratedDocument) => {
        if (editingId) return;
        if (!doc.latex) return;
        
        // Optimistically update active state if needed, though URL change will eventually trigger it
        if (activeDocumentId !== doc.id) {
            GenerateActions.setActiveDocument(doc.id);
            router.push(`/generate/${doc.id}`);
        }
    };

    const handleNewChat = () => {
        GenerateActions.setActiveDocument(null);
        router.push('/generate');
    };

    return (
        <Sidebar collapsible="offcanvas" data-onboarding-target="generate-sidebar">
            <SidebarHeader className="flex-row items-center justify-between border-b border-gray-200 py-3">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleNewChat}
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
                                <div key={doc.id} className="group/doc relative mb-1">
                                    {editingId === doc.id ? (
                                        <div className="flex items-center gap-2 px-2 py-2">
                                            <Input
                                                ref={inputRef}
                                                value={editTitle}
                                                onChange={(e) => setEditTitle(e.target.value)}
                                                onKeyDown={handleKeyDown}
                                                onBlur={saveRename}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                    ) : (
                                        <>
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
                                            
                                            <div className="absolute right-1 top-2 opacity-0 transition-opacity group-hover/doc:opacity-100 data-[state=open]:opacity-100">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={(e) => startRenaming(doc, e)}>
                                                            <Pencil className="mr-2 h-4 w-4" />
                                                            Rename
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))
                        )}
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    );
}
