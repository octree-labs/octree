import { NextRequest, NextResponse } from 'next/server';
import { trackRedditConversion } from '@/lib/reddit-capi';

export async function POST(request: NextRequest) {
  try {
    const { eventName, conversionId, email, externalId } = await request.json();

    if (!eventName || !conversionId) {
      return NextResponse.json(
        { error: 'eventName and conversionId are required' },
        { status: 400 }
      );
    }

    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      undefined;
    const userAgent = request.headers.get('user-agent') || undefined;

    await trackRedditConversion({
      eventName,
      conversionId,
      email,
      externalId,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reddit CAPI route error:', error);
    return NextResponse.json(
      { error: 'Failed to track conversion' },
      { status: 500 }
    );
  }
}
