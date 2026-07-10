import { Type } from '@sinclair/typebox';

export const BookBody = Type.Object(
  {
    slotId: Type.String({ format: 'uuid' }),
    mode: Type.Union([Type.Literal('video'), Type.Literal('audio'), Type.Literal('chat')], {
      default: 'video',
    }),
    reason: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false },
);
