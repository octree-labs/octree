
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ run_id: string }> }
) {
    try {
        const { run_id } = await params;

        if (!run_id) {
            return NextResponse.json(
                { error: 'Run ID is required' },
                { status: 400 }
            );
        }

        // TODO: Initialize Supabase client
        // TODO: Fetch artifacts for the given run_id from the database

        // Mock response for now
        const artifacts = [
            {
                id: 'artifact_1',
                run_id: run_id,
                name: 'generated_code.ts',
                type: 'code',
                content: '// This is a generated code artifact',
                created_at: new Date().toISOString(),
            },
            {
                id: 'artifact_2',
                run_id: run_id,
                name: 'documentation.md',
                type: 'markdown',
                content: '# Documentation\n\nGenerated documentation.',
                created_at: new Date().toISOString(),
            },
        ];

        return NextResponse.json({
            run_id: run_id,
            artifacts: artifacts,
        });
    } catch (error) {
        console.error('Error fetching artifacts:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
