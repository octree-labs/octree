
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { prompt } = body;

        if (!prompt) {
            return NextResponse.json(
                { error: 'Prompt is required' },
                { status: 400 }
            );
        }

        // TODO: Initialize Supabase client
        // TODO: Create a new run entry in the database

        // Mock response for now
        const runId = `run_${Date.now()}`;

        // TODO: Trigger the actual generation process (e.g., via queue or direct service call)

        return NextResponse.json({
            run_id: runId,
            status: 'queued',
            message: 'Generation task started successfully'
        });

    } catch (error) {
        console.error('Error processing generation request:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
