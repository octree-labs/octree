export type CollaboratorRole = 'owner' | 'editor';

export interface Collaborator {
  id: string;
  project_id: string;
  user_id: string;
  role: CollaboratorRole;
  invited_by: string | null;
  created_at: string;
  // Joined from auth.users
  email?: string;
  name?: string;
}

export interface ProjectInvitation {
  id: string;
  project_id: string;
  email: string | null;
  token: string;
  role: CollaboratorRole;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface CollaboratorPresence {
  id: string;
  user_id: string;
  name: string;
  email: string;
  color: string;
  cursor?: {
    lineNumber: number;
    column: number;
  };
  selection?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  lastActive: number;
}

// Generate consistent color for user
export function getUserColor(userId: string): string {
  const colors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#96CEB4', // Green
    '#FFEAA7', // Yellow
    '#DDA0DD', // Plum
    '#98D8C8', // Mint
    '#F7DC6F', // Gold
    '#BB8FCE', // Purple
    '#85C1E9', // Light Blue
  ];
  
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

