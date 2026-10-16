'use client';

import React, { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class PDFErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('PDF Viewer Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center">
          <AlertTriangle className="mb-4 h-8 w-8 text-amber-500" />
          <h3 className="mb-2 text-lg font-semibold text-slate-900">
            PDF Viewer Error
          </h3>
          <p className="text-sm text-slate-600">
            Unable to load the PDF viewer. This might be due to browser compatibility issues.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 rounded-md bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PDFErrorBoundary; 