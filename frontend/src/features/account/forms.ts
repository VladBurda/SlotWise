import { z } from 'zod';

export type AccountMode =
  'login' | 'register' | 'forgot' | 'reset' | 'verify' | 'invite';
export function accountSchema(mode: AccountMode) {
  return z
    .object({
      email: z.string().optional(),
      name: z.string().optional(),
      password: z.string().optional(),
    })
    .superRefine((values, context) => {
      if (
        ['login', 'register', 'forgot'].includes(mode) &&
        !z.string().email().safeParse(values.email).success
      ) {
        context.addIssue({
          code: 'custom',
          path: ['email'],
          message: 'Enter a valid email address.',
        });
      }
      if (
        mode === 'register' &&
        (!values.name?.trim() || values.name.length > 100)
      )
        context.addIssue({
          code: 'custom',
          path: ['name'],
          message: 'Enter your name (up to 100 characters).',
        });
      if (['login', 'register', 'reset'].includes(mode)) {
        const min = mode === 'login' ? 1 : 12;
        if (
          !values.password ||
          values.password.length < min ||
          values.password.length > 128
        )
          context.addIssue({
            code: 'custom',
            path: ['password'],
            message: `Use ${min}–128 characters.`,
          });
      }
    });
}
export type AccountValues = z.infer<ReturnType<typeof accountSchema>>;
export const workspaceFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a workspace name.').max(100),
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers and single hyphens.',
    ),
  timezone: z.string().min(1).max(64),
});
export type WorkspaceValues = z.infer<typeof workspaceFormSchema>;
