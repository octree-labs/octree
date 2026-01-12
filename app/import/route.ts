/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TablesInsert } from '@/database.types';
import { getContentTypeByFilename } from '@/lib/constants/file-types';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const draftId = url.searchParams.get('draft');
  if (!draftId) {
    return NextResponse.redirect(new URL('/', url.origin));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/auth/login', url.origin);
    loginUrl.searchParams.set(
      'next',
      `/import?draft=${encodeURIComponent(draftId)}`
    );
    return NextResponse.redirect(loginUrl);
  }

  // Check if user has completed onboarding
  type UsageRecord = {
    onboarding_completed: boolean | null;
  };

  const { data: usageData } = await supabase
    .from('user_usage')
    .select('onboarding_completed')
    .eq('user_id', user.id)
    .maybeSingle<UsageRecord>();

  if (!usageData?.onboarding_completed) {
    const onboardingUrl = new URL('/onboarding', url.origin);
    onboardingUrl.searchParams.set(
      'next',
      `/import?draft=${encodeURIComponent(draftId)}`
    );
    return NextResponse.redirect(onboardingUrl);
  }

  // Fetch draft
  const { data: draft, error: draftError } = await (supabase
    .from('drafts' as any)
    .select('*')
    .eq('id', draftId)
    .single() as any);

  if (draftError || !draft) {
    return NextResponse.redirect(new URL('/', url.origin));
  }

  const title: string = (draft.title as string) || 'Imported from Tools';
  const content: string = draft.content as string;

  // Create project
  const projectData: TablesInsert<'projects'> = {
    title: title.slice(0, 120),
    user_id: user.id,
  };

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert(projectData)
    .select()
    .single();

  if (projectError || !project) {
    return NextResponse.redirect(new URL('/', url.origin));
  }

  // Upload file content to Supabase Storage
  const mimeType = getContentTypeByFilename('main.tex');
  const blob = new Blob([content], { type: mimeType });
  const filePath = `projects/${project.id}/main.tex`;

  const { error: uploadError } = await supabase.storage
    .from('octree')
    .upload(filePath, blob, {
      cacheControl: '3600',
      upsert: false,
      contentType: mimeType,
    });

  if (uploadError) {
    console.error('Error uploading file to storage:', uploadError);
    return NextResponse.redirect(new URL('/', url.origin));
  }

  // Get public URL for the file
  const { data: urlData } = supabase.storage
    .from('octree')
    .getPublicUrl(filePath);

  // Insert file record
  const fileToInsert: TablesInsert<'files'> = {
    project_id: project.id,
    name: 'main.tex',
    type: mimeType,
    size: content.length,
    url: urlData.publicUrl,
  };

  const { error: fileError } = await supabase
    .from('files')
    .insert(fileToInsert);

  if (fileError) {
    console.error('Error creating file record:', fileError);
    return NextResponse.redirect(
      new URL(`/projects/${project.id}`, url.origin)
    );
  }

  // Delete draft (best effort)
  await (supabase
    .from('drafts' as any)
    .delete()
    .eq('id', draftId) as any);

  return NextResponse.redirect(new URL(`/projects/${project.id}`, url.origin));
}
