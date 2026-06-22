import type { PublicUser } from '@embeding/schemas/auth';
import type { Role } from '../../prisma/client';

export type DbUserLike = {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
};

/** Единый маппер User → PublicUser (без passwordHash; createdAt в ISO). */
export function toPublicUser(u: DbUserLike): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  };
}
