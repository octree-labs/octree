'use client';

/**
 * Cache edit limit status to avoid repeated API calls
 * Refreshes every 30 seconds or on explicit refresh
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { FREE_DAILY_EDIT_LIMIT } from '@/data/constants';

interface EditLimitStatus {
  canEdit: boolean;
  editCount: number;
  limit: number;
  isLoading: boolean;
  lastChecked: number | null;
}

const CACHE_DURATION = 30000; // 30 seconds

export function useEditLimitCache() {
  const [status, setStatus] = useState<EditLimitStatus>({
    canEdit: true,
    editCount: 0,
    limit: FREE_DAILY_EDIT_LIMIT, // Default to free user daily limit
    isLoading: false,
    lastChecked: null,
  });

  const fetchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const fetchLimitStatus = useCallback(async (force: boolean) => {
    const now = Date.now();
    
    // Use cache if recent and not forced
    if (!force && status.lastChecked && (now - status.lastChecked) < CACHE_DURATION) {
      return status;
    }

    setStatus(prev => ({ ...prev, isLoading: true }));

    try {
      const response = await fetch('/api/track-edit', {
        method: 'GET', // GET for checking status only
      });

      if (!response.ok) {
        throw new Error('Failed to fetch edit limits');
      }

      const data = await response.json();

      const newStatus = {
        canEdit: data.canEdit,
        editCount: data.editCount || 0,
        limit: data.limit || 100,
        isLoading: false,
        lastChecked: now,
      };

      setStatus(newStatus);
      return newStatus;
    } catch (error) {
      console.error('Error fetching edit limits:', error);
      setStatus(prev => ({ ...prev, isLoading: false }));
      return status;
    }
  }, [status]);

  const trackEdit = useCallback(async () => {
    // Optimistically increment local count
    setStatus(prev => ({
      ...prev,
      editCount: prev.editCount + 1,
      canEdit: prev.editCount + 1 < prev.limit,
    }));

    // Track in background (fire and forget)
    fetch('/api/track-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(err => console.error('Failed to track edit:', err));

    // Refresh status after a short delay
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }
    fetchTimeoutRef.current = setTimeout(() => {
      fetchLimitStatus(true);
    }, 1000);
  }, [fetchLimitStatus]);

  // Listen for usage updates from other components
  useEffect(() => {
    const handleUsageUpdate = () => {
      fetchLimitStatus(true);
    };

    window.addEventListener('usage-update', handleUsageUpdate);
    return () => window.removeEventListener('usage-update', handleUsageUpdate);
  }, [fetchLimitStatus]);

  // Initial fetch
  useEffect(() => {
    fetchLimitStatus(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    canEdit: status.canEdit,
    editCount: status.editCount,
    limit: status.limit,
    isLoading: status.isLoading,
    trackEdit,
    refreshStatus: () => fetchLimitStatus(true),
  };
} 