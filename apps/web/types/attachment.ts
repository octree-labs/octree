export interface FileAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  content?: string; // Text content for text files
  preview?: string; // Data URL for images
  status: 'uploading' | 'ready' | 'error';
  error?: string;
}

export const ACCEPTED_FILE_TYPES = {
  // Documents
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'text/x-tex': ['.tex'],
  'application/x-tex': ['.tex'],
  
  // Images
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  
  // Code files
  'text/javascript': ['.js'],
  'text/typescript': ['.ts'],
  'application/json': ['.json'],
  'text/html': ['.html'],
  'text/css': ['.css'],
  'application/xml': ['.xml'],
  
  // Office documents
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_ATTACHMENTS = 5;

