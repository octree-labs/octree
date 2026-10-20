import { SettingsCardSkeleton } from '@/components/settings/settings-card-skeleton';

// Rendered inside the settings layout, so the title and tabs stay on screen
// while a tab's page loads.
export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <SettingsCardSkeleton rows={2} />
      <SettingsCardSkeleton rows={1} />
    </div>
  );
}
