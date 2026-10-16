import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TablesInsert } from '@/database.types';
import JSZip from 'jszip';
import {
  getContentTypeByFilename,
  SUPPORTED_TEXT_FILE_EXTENSIONS,
} from '@/lib/constants/file-types';

// Route segment config for App Router
export const maxDuration = 60; // 60 seconds timeout for processing
export const dynamic = 'force-dynamic';

const MAX_FILES = 1000; // Maximum files per project

interface ExtractedFile {
  name: string; // Full relative path including folders (e.g., "figures/image.png")
  content: string | ArrayBuffer;
  isText: boolean;
  size: number;
}

interface ImportRequest {
  storagePath: string;
  fileName: string;
}

export async function POST(request: NextRequest) {
  let tempStoragePath: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse JSON body (small payload - just the storage path)
    const body: ImportRequest = await request.json();
    const { storagePath, fileName } = body;

    if (!storagePath || !fileName) {
      return NextResponse.json(
        { error: 'Missing storagePath or fileName' },
        { status: 400 }
      );
    }

    // Validate the storage path belongs to this user's temp folder
    if (!storagePath.startsWith(`temp-imports/${user.id}/`)) {
      return NextResponse.json(
        { error: 'Invalid storage path' },
        { status: 403 }
      );
    }

    tempStoragePath = storagePath;

    // Check file type
    if (!fileName.endsWith('.zip')) {
      return NextResponse.json(
        { error: 'Only ZIP files are supported' },
        { status: 400 }
      );
    }

    // Download the ZIP file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('octree')
      .download(storagePath);

    if (downloadError || !fileData) {
      console.error('Failed to download ZIP from storage:', downloadError);
      return NextResponse.json(
        { error: 'Failed to retrieve uploaded file' },
        { status: 500 }
      );
    }

    // Read and extract ZIP
    const arrayBuffer = await fileData.arrayBuffer();
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(arrayBuffer);

    // Extract all files
    const extractedFiles: ExtractedFile[] = [];
    const texFiles: ExtractedFile[] = [];

    const fileEntries = Object.entries(zipContent.files);

    if (fileEntries.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Too many files. Maximum ${MAX_FILES} files allowed.` },
        { status: 400 }
      );
    }

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

    // If all files sit inside a single top-level folder, strip it to
    // avoid double-nesting (the project root already acts as that folder).
    if (extractedFiles.length > 0) {
      const firstSlash = extractedFiles[0].name.indexOf('/');
      if (firstSlash > 0) {
        const root = extractedFiles[0].name.slice(0, firstSlash + 1);
        const allShareRoot = extractedFiles.every((f) => f.name.startsWith(root));
        if (allShareRoot) {
          for (const file of extractedFiles) {
            file.name = file.name.slice(root.length);
          }
        }
      }
    }

    // Check if we have at least one .tex file
    if (texFiles.length === 0) {
      return NextResponse.json(
        { error: 'No LaTeX (.tex) files found in ZIP' },
        { status: 400 }
      );
    }

    // Determine project title from filename
    const projectTitle =
      fileName.replace('.zip', '').slice(0, 120) || 'Imported Project';

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

    // Clean up temp file after successful processing
    if (tempStoragePath) {
      await supabase.storage
        .from('octree')
        .remove([tempStoragePath])
        .catch((err) => console.error('Failed to cleanup temp file:', err));
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

    // Clean up temp file on error
    if (tempStoragePath) {
      const supabase = await createClient();
      await supabase.storage
        .from('octree')
        .remove([tempStoragePath])
        .catch((err) => console.error('Failed to cleanup temp file:', err));
    }

    return NextResponse.json(
      { error: 'Failed to import project. Please check your ZIP file.' },
      { status: 500 }
    );
  }
}
