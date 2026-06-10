import { withAdvisoryLock } from '../lib/advisoryLock.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';

import { JOB_KEYS } from './keys.js';

const RETENTION_DAYS = 30;

export async function runCleanupRefreshTokens(): Promise<void> {
  await withAdvisoryLock(JOB_KEYS.CLEANUP_REFRESH_TOKENS, async () => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Delete tokens that expired more than 30 days ago AND are not recently revoked.
    // Recently revoked tokens (revokedAt within 30 days) are kept so replay-attack
    // detection (family rotation) has a full 30-day window to surface TOKEN_REUSED.
    const { count } = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: cutoff },
        OR: [{ revokedAt: null }, { revokedAt: { lt: cutoff } }],
      },
    });

    if (count > 0) {
      logger.info({ count }, 'Purged expired/revoked refresh tokens');
    }
  });
}
