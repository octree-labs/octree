import { Resend } from 'resend';

export const resend = new Resend(process.env.RESEND_API_KEY);
export const FROM_ADDRESS = 'Basil from Octree <basil@useoctree.online>';
