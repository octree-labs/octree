-- ============================================================================
-- Collaboration Tables Migration
-- ============================================================================

-- project_collaborators: tracks who has access to which projects
CREATE TABLE IF NOT EXISTS project_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  invited_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- project_invitations: pending email/link invites
CREATE TABLE IF NOT EXISTS project_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT,
  token TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor')),
  invited_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_project_invitations_project_id ON project_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invitations_token ON project_invitations(token);
CREATE INDEX IF NOT EXISTS idx_project_invitations_email ON project_invitations(email);

-- ============================================================================
-- Row Level Security Policies
-- ============================================================================

ALTER TABLE project_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invitations ENABLE ROW LEVEL SECURITY;

-- Collaborators: Users can see collaborators for projects they have access to
CREATE POLICY "Users can view collaborators for accessible projects"
  ON project_collaborators
  FOR SELECT
  USING (
    -- User is the project owner
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_collaborators.project_id 
      AND projects.user_id = auth.uid()
    )
    OR
    -- User is a collaborator on the project
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM project_collaborators pc2
      WHERE pc2.project_id = project_collaborators.project_id
      AND pc2.user_id = auth.uid()
    )
  );

-- Only project owners can add collaborators
CREATE POLICY "Project owners can add collaborators"
  ON project_collaborators
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_collaborators.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- Only project owners can remove collaborators
CREATE POLICY "Project owners can remove collaborators"
  ON project_collaborators
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_collaborators.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- Invitations: Users can view invitations for their projects
CREATE POLICY "Users can view invitations for their projects"
  ON project_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_invitations.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- Only project owners can create invitations
CREATE POLICY "Project owners can create invitations"
  ON project_invitations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_invitations.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- Project owners can update/delete invitations
CREATE POLICY "Project owners can manage invitations"
  ON project_invitations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_invitations.project_id 
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Project owners can delete invitations"
  ON project_invitations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_invitations.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Helper function to check project access
-- ============================================================================

CREATE OR REPLACE FUNCTION has_project_access(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM project_collaborators 
    WHERE project_id = p_project_id AND user_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Migrate existing projects: Add owners to collaborators table
-- ============================================================================

INSERT INTO project_collaborators (project_id, user_id, role, created_at)
SELECT id, user_id, 'owner', created_at
FROM projects
ON CONFLICT (project_id, user_id) DO NOTHING;

