'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const REFERRAL_OPTIONS = [
  { value: 'search', label: 'Google' },
  { value: 'friend', label: 'Friend or colleague' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X' },
  { value: 'other', label: 'Other' },
];

export default function OnboardingPage() {
  const [referralSource, setReferralSource] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async () => {
    if (!referralSource) {
      toast.error('Please select how you found Octree');
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        toast.error('Session expired. Please log in again.');
        router.push('/auth/login');
        return;
      }

      const { data: updatedRows } = await supabase
        .from('user_usage')
        // @ts-ignore - Supabase type generation issue
        .update({
          referral_source: referralSource,
          onboarding_completed: true,
        })
        .eq('user_id', user.id)
        .select('user_id');

      if (!updatedRows || updatedRows.length === 0) {
        const { error: insertError } = await supabase
          .from('user_usage')
          // @ts-ignore - Supabase type generation issue
          .insert({
            user_id: user.id,
            referral_source: referralSource,
            onboarding_completed: true,
          });

        if (insertError) {
          throw insertError;
        }
      }

      toast.success('Thanks for the info!');
      router.push('/');
    } catch (error) {
      console.error('Onboarding submission failed', error);
      toast.error('Failed to save your response. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Welcome to Octree!</CardTitle>
            <CardDescription>
              Help us improve by letting us know how you found us.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="referral-source">
                How did you hear about us?
              </Label>
              <Select value={referralSource} onValueChange={setReferralSource}>
                <SelectTrigger id="referral-source">
                  <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                  {REFERRAL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={isSubmitting || !referralSource}
            >
              {isSubmitting ? 'Saving...' : 'Continue'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
