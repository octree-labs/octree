import { EventSchemas, Inngest } from 'inngest';

type Events = {
  'user/confirmed': { data: { email: string; userId: string } };
  'user/signed-in': { data: { email: string } };

};

export const inngest = new Inngest({
  id: 'octree',
  schemas: new EventSchemas().fromRecord<Events>(),
});
