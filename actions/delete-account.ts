'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { Database } from '@/database.types';
import { stripe } from '@/lib/stripe';

export async function deleteAccount() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const supabaseAdmin = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const userId = user.id;

  try {
    const { data: projects } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('user_id', userId);

    const projectIds = projects?.map((p) => p.id) || [];

    const { data: documents } = await supabaseAdmin
      .from('documents')
      .select('id')
      .eq('owner_id', userId);

    const documentIds = documents?.map((d) => d.id) || [];

    if (documentIds.length > 0) {
      await supabaseAdmin
        .from('document_versions')
        .delete()
        .in('document_id', documentIds);
    }

    await supabaseAdmin.from('documents').delete().eq('owner_id', userId);

    await supabaseAdmin
      .from('generated_documents')
      .delete()
      .eq('user_id', userId);

    if (projectIds.length > 0) {
      // Delete all project files from Supabase Storage
      for (const projectId of projectIds) {
        try {
          const projectFolderPath = `projects/${projectId}`;
          const { data: storageFiles } = await supabaseAdmin.storage
            .from('octree')
            .list(projectFolderPath);

          if (storageFiles && storageFiles.length > 0) {
            const filePaths = storageFiles.map(
              (file) => `${projectFolderPath}/${file.name}`
            );
            await supabaseAdmin.storage.from('octree').remove(filePaths);
          }
        } catch (storageError) {
          console.error(`Failed to delete storage for project ${projectId}:`, storageError);
        }
      }

      await supabaseAdmin.from('files').delete().in('project_id', projectIds);

      await supabaseAdmin
        .from('project_zotero_sources' as any)
        .delete()
        .in('project_id', projectIds);

      await supabaseAdmin
        .from('project_collaborators')
        .delete()
        .in('project_id', projectIds);

      await supabaseAdmin
        .from('project_invitations')
        .delete()
        .in('project_id', projectIds);
    }

    await supabaseAdmin
      .from('project_collaborators')
      .delete()
      .eq('user_id', userId);

    if (user.email) {
      await supabaseAdmin
        .from('project_invitations')
        .delete()
        .eq('email', user.email);
    }

    await supabaseAdmin.from('projects').delete().eq('user_id', userId);

    const { data: userUsage } = await supabaseAdmin
      .from('user_usage')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (userUsage?.stripe_customer_id) {
      try {
        await stripe.customers.del(userUsage.stripe_customer_id);
      } catch (error) {
        console.error('Failed to delete Stripe customer:', error);
      }
    }

    await supabaseAdmin.from('user_usage').delete().eq('user_id', userId);
    await supabaseAdmin.from('user_walkthroughs').delete().eq('user_id', userId);

    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(
      userId
    );

    if (deleteUserError) {
      throw new Error(deleteUserError.message);
    }

    await supabase.auth.signOut();
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'An error occurred',
    };
  }

  revalidatePath('/');
  return { success: true };
}
