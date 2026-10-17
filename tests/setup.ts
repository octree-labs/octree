import '@testing-library/jest-dom';

// Mock toast notifications globally to avoid side effects in tests
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// Mock the edit limit cache to always allow edits during tests
vi.mock('@/hooks/use-edit-limit-cache', () => ({
  useEditLimitCache: () => ({ canEdit: true }),
}));


