import { Type } from '@sinclair/typebox';

const strongPassword = Type.String({
  minLength: 10,
  maxLength: 128,
  description: 'At least 10 chars; enforce complexity at the edge/IdP in production.',
});

export const RegisterBody = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 254 }),
    password: strongPassword,
    phone: Type.Optional(Type.String({ minLength: 8, maxLength: 20 })),
    role: Type.Optional(Type.Union([Type.Literal('patient'), Type.Literal('doctor')])),
  },
  { additionalProperties: false },
);

export const LoginBody = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 254 }),
    password: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const MfaCompleteBody = Type.Object(
  {
    mfaToken: Type.String(),
    code: Type.String({ minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' }),
  },
  { additionalProperties: false },
);

export const MfaEnableBody = Type.Object(
  { code: Type.String({ minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' }) },
  { additionalProperties: false },
);

export const RefreshBody = Type.Object(
  { refreshToken: Type.String() },
  { additionalProperties: false },
);

export const TokenPairResponse = Type.Object({
  tokenType: Type.Literal('Bearer'),
  accessToken: Type.String(),
  refreshToken: Type.String(),
  expiresIn: Type.Integer(),
});

export const LoginResponse = Type.Union([
  Type.Object({ mfaRequired: Type.Literal(false), ...TokenPairResponse.properties }),
  Type.Object({ mfaRequired: Type.Literal(true), mfaToken: Type.String() }),
]);

export const RegisterResponse = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const MeResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  role: Type.String(),
  mfaEnabled: Type.Boolean(),
  emailVerified: Type.Boolean(),
});

export const MfaSetupResponse = Type.Object({
  otpauthUrl: Type.String(),
  qrDataUrl: Type.String(),
});
