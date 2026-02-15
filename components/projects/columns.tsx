'use client';

import { ColumnDef } from '@tanstack/react-table';
import dayjs from 'dayjs';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Database } from '@/database.types';

type Project = Database['public']['Tables']['projects']['Row'];

export const columns = ({
  onDelete,
  onRename,
}: {
  onDelete: (projectId: string, projectTitle: string) => void;
  onRename: (projectId: string, projectTitle: string) => void;
}): ColumnDef<Project>[] => [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => {
      const title = row.getValue('title') as string;
      return (
        <div className="max-w-[140px] truncate sm:max-w-[180px] md:max-w-[450px] lg:max-w-[400px] xl:max-w-[700px]" title={title}>
          {title}
        </div>
      );
    },
  },
  {
    accessorKey: 'updated_at',
    header: () => <span className="hidden md:block">Last Updated</span>,
    cell: ({ row }) => {
      return (
        <span className="hidden md:block">
          {dayjs(row.getValue('updated_at')).format('MMM D, YYYY h:mm A')}
        </span>
      );
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const project = row.original;

      return (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <DropdownMenuLabel>Actions</DropdownMenuLabel>

              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => {
                  onRename(project.id, project.title);
                }}
              >
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                variant="destructive"
                onClick={() => {
                  onDelete(project.id, project.title);
                }}
              >
                <Trash2 className="size-4 text-destructive" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      );
    },
  },
];
