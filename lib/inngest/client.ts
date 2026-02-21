import { EventSchemas, Inngest } from 'inngest';

type Events = {
  'user/confirmed': { data: { email: string } };
  'user/signed-in': { data: { email: string } };
  'subscription/trial-started': { data: { email: string; trialEndsAt: string } };
};

export const inngest = new Inngest({
  id: 'octree',
  schemas: new EventSchemas().fromRecord<Events>(),
});
