import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TablesInsert } from '@/database.types';
import JSZip from 'jszip';
import {
  getContentTypeByFilename,
  SUPPORTED_TEXT_FILE_EXTENSIONS,
} from '@/lib/constants/file-types';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit
const MAX_FILES = 1000; // Maximum files per project

interface ExtractedFile {
  name: string; // Full relative path including folders (e.g., "figures/image.png")
  content: string | ArrayBuffer;
  isText: boolean;
  size: number;
}

// Helper function to process files from folder upload
async function processFolderFiles(
  files: File[]
): Promise<{ extractedFiles: ExtractedFile[]; texFiles: ExtractedFile[] }> {
  const extractedFiles: ExtractedFile[] = [];
  const texFiles: ExtractedFile[] = [];

  for (const file of files) {
    // Skip hidden files and common non-essential files
    const relativePath = (file as any).webkitRelativePath || file.name;
    const pathParts = relativePath.split('/');
    const fileName = pathParts[pathParts.length - 1];

    if (
      pathParts.some((part) => part.startsWith('.')) ||
      fileName.startsWith('.') ||
      fileName.startsWith('._') ||
      pathParts.includes('__MACOSX')
    ) {
      continue;
    }

    // Normalize path: remove leading folder name if present
    // webkitRelativePath includes the root folder name, we want relative paths
    let normalizedPath = relativePath;
    if (normalizedPath.includes('/')) {
      // Remove the first directory (the root folder selected by user)
      const parts = normalizedPath.split('/');
      if (parts.length > 1) {
        normalizedPath = parts.slice(1).join('/');
      }
    }

    const isTexFile = fileName.endsWith('.tex');
    const isTextFile = SUPPORTED_TEXT_FILE_EXTENSIONS.some((ext) =>
      fileName.toLowerCase().endsWith(ext)
    );

    try {
      let content: string | ArrayBuffer;
      let isText = false;

      if (isTextFile) {
        content = await file.text();
        isText = true;
      } else {
        content = await file.arrayBuffer();
        isText = false;
      }

      const extractedFile: ExtractedFile = {
        name: normalizedPath,
        content,
        isText,
        size: isText
          ? (content as string).length
          : (content as ArrayBuffer).byteLength,
      };

      extractedFiles.push(extractedFile);

      if (isTexFile) {
        texFiles.push(extractedFile);
      }
    } catch (error) {
      console.error(`Failed to process file ${relativePath}:`, error);
    }
  }

  return { extractedFiles, texFiles };
}

// Helper function to process ZIP file
async function processZipFile(
  file: File
): Promise<{ extractedFiles: ExtractedFile[]; texFiles: ExtractedFile[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = new JSZip();
  const zipContent = await zip.loadAsync(arrayBuffer);

  const extractedFiles: ExtractedFile[] = [];
  const texFiles: ExtractedFile[] = [];

  const fileEntries = Object.entries(zipContent.files);

  for (const [relativePath, zipEntry] of fileEntries) {
    if (zipEntry.dir) continue;

    // Skip hidden files and common non-essential directories
    if (
      relativePath.startsWith('__MACOSX/') ||
      relativePath.includes('/.') ||
      relativePath.startsWith('.') ||
      relativePath.includes('/._') // macOS resource forks
    ) {
      continue;
    }

    // Use the full relative path as-is to preserve folder structure
    const fileName = relativePath.split('/').pop() || relativePath;
    const isTexFile = fileName.endsWith('.tex');

    const isTextFile = SUPPORTED_TEXT_FILE_EXTENSIONS.some((ext) =>
      fileName.toLowerCase().endsWith(ext)
    );

    try {
      let content: string | ArrayBuffer;
      let isText = false;

      if (isTextFile) {
        content = await zipEntry.async('text');
        isText = true;
      } else {
        content = await zipEntry.async('arraybuffer');
        isText = false;
      }

      const extractedFile: ExtractedFile = {
        name: relativePath, // Use full relative path to preserve folder structure
        content,
        isText,
        size: isText
          ? (content as string).length
          : (content as ArrayBuffer).byteLength,
      };

      extractedFiles.push(extractedFile);

      if (isTexFile) {
        texFiles.push(extractedFile);
      }
    } catch (error) {
      console.error(`Failed to extract file ${relativePath}:`, error);
    }
  }

  return { extractedFiles, texFiles };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse form data
    const formData = await request.formData();
    
    // Check if this is a ZIP file or folder upload
    const file = formData.get('file') as File | null;
    const files = formData.getAll('files') as File[];

    let extractedFiles: ExtractedFile[] = [];
    let texFiles: ExtractedFile[] = [];
    let projectTitle = 'Imported Project';

    // Handle ZIP file upload
    if (file && file.name.endsWith('.zip')) {
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: 'File size exceeds 50MB limit' },
          { status: 400 }
        );
      }

      const result = await processZipFile(file);
      extractedFiles = result.extractedFiles;
      texFiles = result.texFiles;
      projectTitle = file.name.replace('.zip', '').slice(0, 120) || 'Imported Project';
    }
    // Handle folder upload (multiple files)
    else if (files.length > 0) {
      // Check total size
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      if (totalSize > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: 'Total file size exceeds 50MB limit' },
          { status: 400 }
        );
      }

      if (files.length > MAX_FILES) {
        return NextResponse.json(
          { error: `Too many files. Maximum ${MAX_FILES} files allowed.` },
          { status: 400 }
        );
      }

      const result = await processFolderFiles(files);
      extractedFiles = result.extractedFiles;
      texFiles = result.texFiles;
      
      // Try to determine project title from folder name or first file
      if (files[0] && (files[0] as any).webkitRelativePath) {
        const folderName = (files[0] as any).webkitRelativePath.split('/')[0];
        projectTitle = folderName.slice(0, 120) || 'Imported Project';
      } else if (files[0]) {
        projectTitle = files[0].name.replace(/\.[^/.]+$/, '').slice(0, 120) || 'Imported Project';
      }
    } else {
      return NextResponse.json(
        { error: 'No files provided. Please upload a ZIP file or select a folder.' },
        { status: 400 }
      );
    }

    // Check if we have at least one .tex file
    if (texFiles.length === 0) {
      return NextResponse.json(
        { error: 'No LaTeX (.tex) files found. Please ensure your project contains at least one .tex file.' },
        { status: 400 }
      );
    }

    // Create project
    const projectData: TablesInsert<'projects'> = {
      title: projectTitle,
      user_id: user.id,
    };

    const { data: project, error: projectError } =
      await // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('projects') as any).insert(projectData).select().single();

    if (projectError || !project) {
      console.error('Error creating project:', projectError);
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      );
    }

    // Upload all files to Supabase Storage
    const uploadPromises = extractedFiles.map(async (file) => {
      try {
        const mimeType = getContentTypeByFilename(file.name);
        let blob: Blob;

        if (file.isText) {
          blob = new Blob([file.content as string], { type: mimeType });
        } else {
          blob = new Blob([file.content as ArrayBuffer], { type: mimeType });
        }

        const { error: uploadError } = await supabase.storage
          .from('octree')
          .upload(`projects/${project.id}/${file.name}`, blob, {
            cacheControl: '3600',
            upsert: false,
            contentType: mimeType,
          });

        if (uploadError) {
          console.error(`Failed to upload file ${file.name}:`, uploadError);
          return { success: false, error: uploadError, fileName: file.name };
        }

        return { success: true, fileName: file.name };
      } catch (error) {
        console.error(`Error uploading file ${file.name}:`, error);
        return { success: false, error, fileName: file.name };
      }
    });

    const uploadResults = await Promise.all(uploadPromises);
    const uploadErrors = uploadResults.filter((r) => !r.success);

    if (uploadErrors.length > 0) {
      console.error('Some files failed to upload:', uploadErrors);
    }

    return NextResponse.json({
      success: true,
      projectId: project.id,
      totalFiles: extractedFiles.length,
      texFiles: texFiles.length,
      otherFiles: extractedFiles.length - texFiles.length,
    });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: 'Failed to import project. Please check your files and try again.' },
      { status: 500 }
    );
  }
}
